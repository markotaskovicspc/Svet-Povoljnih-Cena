import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  after: vi.fn(), log: vi.fn(), transaction: vi.fn(), product: vi.fn(),
  currentUser: vi.fn(), sessionUpsert: vi.fn(), session: vi.fn(), lookupJob: vi.fn(), repairJob: vi.fn(), customer: vi.fn(),
}));
vi.mock("next/server", async importOriginal => ({
  ...await importOriginal<typeof import("next/server")>(), after: mocks.after,
}));
vi.mock("@/lib/db", () => ({ db: {
  $transaction: mocks.transaction, product: { findMany: mocks.product },
  checkoutSession: { findUnique: mocks.session },
  backgroundJob: { findUnique: mocks.lookupJob, upsert: mocks.repairJob },
} }));
vi.mock("@/lib/auth/session", () => ({ getCurrentUser: mocks.currentUser }));
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
  priceListEntries: [{ price: 999, validFrom: new Date("2026-01-01"), validTo: null,
    priceList: { id: "mp", code: "MP", name: "MP", active: true, validFrom: null, validTo: null } }],
};
const input = {
  guestEmail: "checkout-test@example.com", lines: [{ sku: "TEST", qty: 1 }],
  shipping: { firstName: "Test", lastName: "Kupac", phone: "0600000000", street: "Test", houseNumber: "1", city: "Beograd", postalCode: "11000", country: "RS" },
  shippingMethod: "KAMION", paymentMethod: "POUZECE_GOTOVINA", consent: true,
};
const request = (body = input) => new Request("https://example.com/api/checkout/order", {
  method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" },
});

let committed: { order?: Record<string, unknown>; job?: Record<string, unknown> };
let failQueue: boolean;
let racedOrder: ReturnType<typeof savedOrder> | null;
function savedOrder() {
  return { ...committed.order, supplierFulfillments: [], items: [{ sku: "TEST", qty: 1, withAssembly: false }],
    voucherDiscount: 0, firstPurchaseDiscount: 0, savedCardDiscount: 0 };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.after.mockReset();
  committed = {}; failQueue = false; racedOrder = null;
  mocks.currentUser.mockResolvedValue(null);
  mocks.sessionUpsert.mockResolvedValue({});
  mocks.product.mockResolvedValue([product]);
  mocks.session.mockResolvedValue(null);
  mocks.lookupJob.mockResolvedValue({ id: "job1" });
  mocks.repairJob.mockResolvedValue({ id: "job1" });
  mocks.customer.mockResolvedValue({ id: "customer1" });
  mocks.transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
    const staged: typeof committed = {};
    const tx = {
      order: {
        findFirst: async () => null,
        findUnique: async () => racedOrder,
        create: async ({ data }: { data: Record<string, unknown> }) => {
          staged.order = { ...data, id: "order1" }; return staged.order;
        },
      },
      checkoutSession: { upsert: mocks.sessionUpsert },
      $queryRaw: vi.fn().mockResolvedValueOnce(racedOrder ? [{ orderId: "order1" }] : [{ seq: 1 }]).mockResolvedValueOnce([product]),
      orderItem: { findMany: async () => [{ id: "item1", sku: "TEST" }], update: async () => ({}) },
      warehouse: { findFirst: async () => ({ id: "dc1" }) },
      backgroundJob: { upsert: async ({ create }: { create: Record<string, unknown> }) => {
        if (failQueue) throw new Error("Database queue write failed");
        staged.job = create; return { id: "job1" };
      } },
    };
    const result = await fn(tx);
    if (!racedOrder) expect(mocks.customer).toHaveBeenCalledWith(tx, expect.anything());
    committed = staged;
    return result;
  });
});


it("scheduled retail price must be used when creating the order", async () => {
  mocks.product.mockResolvedValue([{ ...product, fullPrice: 10000,
    priceListEntries: [{ price: 8000, validFrom: new Date("2026-01-01"), validTo: null,
      priceList: { id: "mp", code: "MP", name: "MP", active: true, validFrom: null, validTo: null } }] }]);
  const response = await POST(request());
  const result = await response.json();
  expect(result.ok).toBe(true);
  expect(result.data.subtotal).toBe(8000);
});

it("reusing checkout session with a different buyer and basket must not silently return old order", async () => {
  expect((await POST(request())).status).toBe(201);
  mocks.session.mockResolvedValue({ order: { ...committed.order, supplierFulfillments: [], items: [{ sku: "TEST", qty: 1, withAssembly: false }],
    voucherDiscount: 0, firstPurchaseDiscount: 0, savedCardDiscount: 0 } });
  const response = await POST(request({ ...input, guestEmail: "different-buyer@example.com",
    lines: [{ sku: "DIFFERENT-PRODUCT", qty: 4 }], checkoutSessionId: "shared-browser-session-123" } as typeof input));
  const result = await response.json();
  expect(result).toMatchObject({ ok: false, error: { code: "CHECKOUT_SESSION_MISMATCH" } });
});

it("product whose last retail price was removed must not be orderable from an old cart", async () => {
  mocks.product.mockResolvedValue([{ ...product, priceListEntries: [] }]);
  const response = await POST(request());
  const result = await response.json();
  expect(result).toMatchObject({ ok: false, error: { code: "INACTIVE" } });
});


it.each([
  ["email", { guestEmail: "other@example.com" }],
  ["quantity", { lines: [{ sku: "TEST", qty: 2 }] }],
  ["SKU", { lines: [{ sku: "OTHER", qty: 1 }] }],
  ["assembly", { lines: [{ sku: "TEST", qty: 1, withAssembly: true }] }],
  ["address", { shipping: { ...input.shipping, houseNumber: "12" } }],
  ["recipient", { shipping: { ...input.shipping, firstName: "Drugi" } }],
  ["phone", { shipping: { ...input.shipping, phone: "0611234567" } }],
  ["shipping", { shippingMethod: "KURIR" }],
  ["payment", { paymentMethod: "UPLATA_NA_RACUN" }],
  ["voucher", { voucherCode: "NEWCODE" }],
  ["notes", { notes: "Nova napomena" }],
])("rejects a reused session when only %s changes", async (_field, changes) => {
  expect((await POST(request())).status).toBe(201);
  mocks.session.mockResolvedValue({ order: savedOrder() });
  const response = await POST(request({ ...input, ...changes, checkoutSessionId: "checkout-session-123" } as typeof input));
  expect(response.status).toBe(422);
  expect((await response.json()).error.code).toBe("CHECKOUT_SESSION_MISMATCH");
  expect(mocks.transaction).toHaveBeenCalledOnce();
});

it("does not reuse a guest order for a newly logged-in customer", async () => {
  await POST(request());
  mocks.session.mockResolvedValue({ order: savedOrder() });
  mocks.currentUser.mockResolvedValue({ id: "other-user", userType: "customer" });
  const response = await POST(request({ ...input, checkoutSessionId: "checkout-session-123" } as typeof input));
  expect(response.status).toBe(422);
  expect(mocks.repairJob).not.toHaveBeenCalled();
});

it("returns an identical retry even when the original product is no longer purchasable", async () => {
  await POST(request());
  mocks.session.mockResolvedValue({ order: savedOrder() });
  mocks.product.mockResolvedValue([]);
  const response = await POST(request({ ...input, checkoutSessionId: "checkout-session-123" } as typeof input));
  expect(response.status).toBe(201);
  expect((await response.json()).data.id).toBe("order1");
  expect(mocks.product).toHaveBeenCalledOnce();
  expect(mocks.transaction).toHaveBeenCalledOnce();
});

it.each([false, true])("checks a replay found after acquiring the session lock (changed=%s)", async changed => {
  await POST(request());
  racedOrder = savedOrder();
  mocks.customer.mockClear();
  mocks.session.mockResolvedValue(null);
  const response = await POST(request({ ...input,
    ...(changed ? { guestEmail: "changed@example.com" } : {}),
    checkoutSessionId: "checkout-session-123" } as typeof input));
  expect(response.status).toBe(changed ? 422 : 201);
  expect(mocks.customer).not.toHaveBeenCalled();
  expect(mocks.sessionUpsert).toHaveBeenCalledWith(expect.objectContaining({ update: {} }));
  const result = await response.json();
  if (changed) expect(result.error.code).toBe("CHECKOUT_SESSION_MISMATCH");
  else expect(result.data.id).toBe("order1");
});

it.each(["expired", "future", "disabled", "zero"])("rejects %s retail prices", async kind => {
  const entry = { ...product.priceListEntries[0]!, validTo: null as Date | null, priceList: { ...product.priceListEntries[0]!.priceList } };
  if (kind === "expired") entry.validTo = new Date("2000-01-01");
  if (kind === "future") entry.validFrom = new Date("2100-01-01");
  if (kind === "disabled") entry.priceList.active = false;
  if (kind === "zero") entry.price = 0;
  mocks.product.mockResolvedValue([{ ...product, priceListEntries: [entry] }]);
  expect((await POST(request())).status).toBe(422);
  expect(mocks.transaction).not.toHaveBeenCalled();
});
