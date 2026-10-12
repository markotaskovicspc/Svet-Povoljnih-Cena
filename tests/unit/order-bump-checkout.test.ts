import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ products: vi.fn(), transaction: vi.fn(), create: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { product: { findMany: mocks.products }, $transaction: mocks.transaction } }));
vi.mock("@/lib/auth/session", () => ({ getCurrentUser: async () => null }));
vi.mock("@/lib/customer-master-sync.server", () => ({ upsertWebCustomer: async () => ({ id: "customer" }) }));
vi.mock("@/lib/checkout/first-purchase.server", () => ({ isFirstPurchaseDiscountEligible: async () => false }));
vi.mock("@/lib/pricing/rules", () => ({
  getActivePricingRules: async () => [],
  pricingRuleInputsForProduct: () => ({ linearPromotions: [], loyaltyDiscountPct: null }),
}));
vi.mock("@/lib/checkout/config", () => ({
  isPaymentMethodEnabled: async () => true,
  resolveDeliveryQuote: async () => ({ truckAvailable: true, prices: { kamion: 0, kurir: 299 }, assemblyPricesBySku: {}, assemblyPrice: 0 }),
}));
vi.mock("@/lib/channel-availability.server", () => ({ syncProductChannelAvailability: async () => undefined }));

import { createOrder, createOrderSchema } from "@/lib/api/checkout";

const products = ["CHAIR", "TABLE"].map((sku, index) => ({
  id: `p${index}`, sku, name: sku, isActive: true, availableWebManual: true,
  availableWebAuto: true, articleStatus: "ACTIVE", dcAvailableQty: 10, stock: 10,
  fullPrice: 3000, salePrice: null, discountPct: null, supplier: null,
  categories: [], media: [], actionPrices: [],
  priceListEntries: [{ price: 3000, validFrom: new Date("2026-01-01"), validTo: null,
    priceList: { id: "mp", code: "MP", name: "MP", active: true, validFrom: null, validTo: null } }],
}));
const bump = { offerId: "dining-home-style-v1", sourceSku: "CHAIR", quantity: 1 };
const input = {
  guestEmail: "qa@example.test",
  lines: [{ sku: "CHAIR", qty: 2 }, { sku: "TABLE", qty: 3, orderBump: bump }],
  shipping: { firstName: "Test", lastName: "Kupac", phone: "0600000000", street: "Test", houseNumber: "1", city: "Beograd", postalCode: "11000", country: "RS" },
  shippingMethod: "KAMION", paymentMethod: "POUZECE_GOTOVINA", consent: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.products.mockResolvedValue(products);
  mocks.create.mockImplementation(async ({ data }) => ({ ...data, id: "order" }));
  mocks.transaction.mockImplementation(async fn => fn({
    order: { findFirst: async () => null, create: mocks.create },
    $queryRaw: vi.fn().mockResolvedValueOnce([{ seq: 1 }]).mockResolvedValueOnce(products),
    orderItem: { findMany: async () => products.map(p => ({ id: p.id, sku: p.sku })), update: async () => ({}) },
    warehouse: { findFirst: async () => ({ id: "dc" }) },
    backgroundJob: { upsert: async () => ({ id: "job" }) },
  }));
});

it("commits the bump with the purchased line while leaving the ordinary units and price unchanged", async () => {
  expect(await createOrder(createOrderSchema.parse(input), null)).toMatchObject({ ok: true, data: { total: 15000 } });
  const items = mocks.create.mock.calls[0][0].data.items.createMany.data;
  expect(items[0]).toMatchObject({ sku: "CHAIR", orderBumpOfferId: null, orderBumpQuantity: 0 });
  expect(items[1]).toMatchObject({ sku: "TABLE", qty: 3, orderBumpOfferId: bump.offerId, orderBumpSourceSku: "CHAIR", orderBumpQuantity: 1 });
  expect(Number(items[1].unitPriceSale)).toBe(3000);
});

it("keeps credit for a purchased addition even when the shopper later removes its source", async () => {
  expect(await createOrder(createOrderSchema.parse({ ...input, lines: [input.lines[1]] }), null)).toMatchObject({ ok: true });
  expect(mocks.create.mock.calls[0][0].data.items.createMany.data[0]).toMatchObject({ orderBumpOfferId: bump.offerId, orderBumpSourceSku: "CHAIR", orderBumpQuantity: 1 });
});
