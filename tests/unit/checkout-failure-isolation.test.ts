import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  after: vi.fn(), log: vi.fn(), transaction: vi.fn(), product: vi.fn(),
  session: vi.fn(), lookupJob: vi.fn(), repairJob: vi.fn(), customer: vi.fn(),
}));
vi.mock("next/server", async importOriginal => ({
  ...await importOriginal<typeof import("next/server")>(), after: mocks.after,
}));
vi.mock("@/lib/db", () => ({ db: {
  $transaction: mocks.transaction, product: { findMany: mocks.product },
  checkoutSession: { findUnique: mocks.session },
  backgroundJob: { findUnique: mocks.lookupJob, upsert: mocks.repairJob },
} }));
vi.mock("@/lib/auth/session", () => ({ getCurrentUser: async () => null }));
vi.mock("@/lib/security/rate-limit", () => ({
  checkRateLimitForRequest: async () => ({ ok: true }), RATE_LIMITS: { checkoutOrder: {} }, rateLimitJson: vi.fn(),
}));
vi.mock("@/lib/monitoring", () => ({ logOperationalError: mocks.log }));
// The entire optional worker fails during import, as Playwright did in prod.
vi.mock("@/lib/background-jobs", () => { throw new Error("Missing PDF runtime asset"); });
vi.mock("@/lib/customer-master-sync.server", () => ({ upsertWebCustomer: mocks.customer }));
vi.mock("@/lib/checkout/config", () => ({
  isPaymentMethodEnabled: async () => true,
  resolveDeliveryQuote: async () => ({ truckAvailable: true, prices: { kamion: 0 }, assemblyPricesBySku: {}, assemblyPrice: 0 }),
}));
vi.mock("@/lib/checkout/first-purchase.server", () => ({ isFirstPurchaseDiscountEligible: async () => false }));
vi.mock("@/lib/pricing/rules", () => ({
  getActivePricingRules: async () => [], pricingRuleInputsForProduct: () => ({ linearPromotions: [], loyaltyDiscountPct: null }),
}));
vi.mock("@/lib/channel-availability.server", () => ({ syncProductChannelAvailability: async () => undefined }));

import { POST } from "@/app/api/checkout/order/route";

const product = {
  id: "p1", sku: "TEST", name: "Test", isActive: true, availableWebManual: true,
  availableWebAuto: true, articleStatus: "ACTIVE", dcAvailableQty: 10, stock: 10,
  fullPrice: 999, salePrice: null, discountPct: null, supplier: null,
  categories: [], media: [], actionPrices: [],
};
const input = {
  guestEmail: "checkout-test@example.com", lines: [{ sku: "TEST", qty: 1 }],
  shipping: { firstName: "Test", lastName: "Kupac", phone: "0600000000", street: "Test 1", city: "Beograd", postalCode: "11000", country: "RS" },
  shippingMethod: "KAMION", paymentMethod: "POUZECE_GOTOVINA", consent: true,
};
const request = (body = input) => new Request("https://example.com/api/checkout/order", {
  method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" },
});

let committed: { order?: Record<string, unknown>; job?: Record<string, unknown> };
let failQueue: boolean;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.after.mockReset();
  committed = {}; failQueue = false;
  mocks.product.mockResolvedValue([product]);
  mocks.session.mockResolvedValue(null);
  mocks.lookupJob.mockResolvedValue({ id: "job1" });
  mocks.customer.mockResolvedValue({ id: "customer1" });
  mocks.transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
    const staged: typeof committed = {};
    const tx = {
      order: {
        findFirst: async () => null,
        create: async ({ data }: { data: Record<string, unknown> }) => {
          staged.order = { ...data, id: "order1" }; return staged.order;
        },
      },
      $queryRaw: vi.fn().mockResolvedValueOnce([{ seq: 1 }]).mockResolvedValueOnce([product]),
      orderItem: { findMany: async () => [{ id: "item1", sku: "TEST" }], update: async () => ({}) },
      warehouse: { findFirst: async () => ({ id: "dc1" }) },
      backgroundJob: { upsert: async ({ create }: { create: Record<string, unknown> }) => {
        if (failQueue) throw new Error("Database queue write failed");
        staged.job = create; return { id: "job1" };
      } },
    };
    const result = await fn(tx);
    expect(mocks.customer).toHaveBeenCalledWith(tx, expect.anything());
    committed = staged;
    return result;
  });
});

it("commits buyer, order and durable work, then returns 201 even when worker import is broken", async () => {
  const response = await POST(request());
  expect(response.status).toBe(201);
  expect(committed.order).toMatchObject({ guestEmail: input.guestEmail, customerId: "customer1" });
  expect(committed.job).toMatchObject({ kind: "CHECKOUT_POST_COMMIT", payload: { orderId: "order1" } });
  expect(mocks.after).toHaveBeenCalledOnce();
  await expect(mocks.after.mock.calls[0][0]()).resolves.toBeUndefined();
  expect(mocks.log).toHaveBeenCalledWith("checkout.follow_up.immediate_failed", expect.any(Error), { orderId: "order1" });
  expect((await response.json()).ok).toBe(true);
});

it("keeps success and durable cron work if the platform cannot schedule after()", async () => {
  mocks.after.mockImplementation(() => { throw new Error("waitUntil unavailable"); });
  const response = await POST(request());
  expect(response.status).toBe(201);
  expect(committed.job?.kind).toBe("CHECKOUT_POST_COMMIT");
});

it("does not report success or commit a partial order when its durable queue write fails", async () => {
  failQueue = true;
  expect((await POST(request())).status).toBe(500);
  expect(committed).toEqual({});
  expect(mocks.after).not.toHaveBeenCalled();
});

it("still rejects unavailable stock without saving an order", async () => {
  mocks.product.mockResolvedValue([{ ...product, dcAvailableQty: 1 }]);
  const response = await POST(request({ ...input, lines: [{ sku: "TEST", qty: 2 }] }));
  expect(response.status).toBe(422);
  expect((await response.json()).error.code).toBe("OUT_OF_STOCK");
  expect(mocks.transaction).not.toHaveBeenCalled();
});

it("returns the existing order on replay even if queue repair fails", async () => {
  await POST(request());
  mocks.session.mockResolvedValue({ order: { ...committed.order, supplierFulfillments: [], items: [],
    voucherDiscount: 0, firstPurchaseDiscount: 0, savedCardDiscount: 0,
  } });
  mocks.repairJob.mockRejectedValue(new Error("Queue unavailable"));
  const body = { ...input, checkoutSessionId: "checkout-session-123" };
  const response = await POST(request(body));
  expect(response.status).toBe(201);
  expect((await response.json()).data.id).toBe("order1");
  expect(mocks.transaction).toHaveBeenCalledOnce();
});
