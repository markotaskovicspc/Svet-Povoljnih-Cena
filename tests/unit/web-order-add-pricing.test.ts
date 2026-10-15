import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ preview: vi.fn(), order: vi.fn(), product: vi.fn(), create: vi.fn(), update: vi.fn(), quote: vi.fn(), rules: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: {
  product: { findFirst: async () => ({ id: "product", sku: "SKU" }) },
  order: { findUnique: m.preview },
  $transaction: async (run: (tx: unknown) => unknown) => run({
    $queryRaw: async () => [], order: { findUnique: m.order },
    product: { findUnique: m.product, count: async () => 1 },
    warehouse: { findFirst: async () => ({ id: "dc" }) },
    orderItem: { create: m.create, update: m.update },
  }),
} }));
vi.mock("@/lib/checkout/config", () => ({ resolveDeliveryQuote: m.quote }));
vi.mock("@/lib/channel-availability.server", () => ({ syncProductChannelAvailability: async () => ({ dcAvailable: 10, webAuto: true }) }));
vi.mock("@/lib/web-storefront-availability", () => ({ isProductAvailableOnWeb: () => true, webStorefrontProductWhere: () => ({}) }));
vi.mock("@/lib/receipts", () => ({ issueBuyerReceiptForOrder: vi.fn() }));
vi.mock("@/lib/background-jobs", () => ({ enqueueBackgroundJob: vi.fn(), processBackgroundJob: vi.fn() }));
vi.mock("@/lib/inventory", () => ({ adjustInventory: vi.fn() }));
vi.mock("@/lib/pricing/rules", async original => ({ ...await original<typeof import("@/lib/pricing/rules")>(), getActivePricingRules: m.rules }));
import { addWebOrderItem } from "@/lib/admin/web-order-edit.server";
const now = new Date();
const action = { id: "sale", name: "Akcija", priority: 1, startsAt: new Date(now.getTime() - 60000), endsAt: new Date(now.getTime() + 60000), isPermanent: false };
let product: Record<string, unknown>;
let order: Record<string, unknown>;
beforeEach(() => {
  vi.clearAllMocks();
  order = { id: "order", channel: "WEB", status: "KREIRANO", createdAt: now, updatedAt: now, shipCity: "Beograd", shippingMethod: "KURIR", userId: null, guestLoyaltyEmail: null,
    items: [], fiscalDocuments: [], shipments: [], pickupBatchLines: [], dispatchNotes: [], reclamations: [], paymentRefunds: [], payments: [{ status: "PENDING", provider: "COD" }] };
  product = { id: "product", sku: "SKU", name: "Test", fullPrice: 1000, salePrice: null, discountPct: null, supplier: null, categories: [], media: [], priceListEntries: [], actionPrices: [], action: null };
  m.preview.mockImplementation(async () => order);
  m.order.mockImplementation(async () => order);
  m.product.mockImplementation(async () => product);
  m.quote.mockResolvedValue({ prices: { kurir: 299, kamion: 999 } });
  m.rules.mockResolvedValue({ evaluatedAt: now.toISOString(), loyaltyRules: [{ id: "loyalty", discountPct: 20, priority: 1, updatedAt: now.toISOString() }], linearPromotions: [] });
  // Stop at the write boundary: inspect the price that would be persisted,
  // without stock, receipts, payments or customer-notification side effects.
  m.create.mockRejectedValue(new Error("WRITE_BOUNDARY"));
  m.update.mockRejectedValue(new Error("WRITE_BOUNDARY"));
});
async function add(staffLoyalty: boolean) {
  await expect(addWebOrderItem({ orderId: "order", sku: "SKU", qty: 2, actorId: "admin", staffLoyalty })).rejects.toThrow("WRITE_BOUNDARY");
}
function storedPrice() { return Number(m.create.mock.calls[0][0].data.unitPriceSale); }
it("honors staff loyalty for a guest without enrolling them, including the delivery quote", async () => {
  await add(true);
  expect(storedPrice()).toBe(800);
  expect(m.quote).toHaveBeenCalledWith(expect.objectContaining({ loggedIn: false, staffLoyaltySkus: ["SKU"] }));
  expect(order.userId).toBeNull(); expect(order.guestLoyaltyEmail).toBeNull();
});
it("allows staff to keep regular guest pricing", async () => {
  await add(false); expect(storedPrice()).toBe(1000);
});
it("honors an active action instead of stacking loyalty on it", async () => {
  product.actionPrices = [{ salePrice: 750, action }];
  await add(true); expect(storedPrice()).toBe(750);
});
it("falls back to loyalty when the product action expires", async () => {
  product.actionPrices = [{ salePrice: 750, action: { ...action, endsAt: new Date(now.getTime() - 1) } }];
  await add(true); expect(storedPrice()).toBe(800);
});
it("preserves agreed prices when adding more of an existing item", async () => {
  order.items = [{ id: "item", sku: "SKU", productId: "product", qty: 1, unitPriceFull: 1000, unitPriceSale: 650, warehouseId: "dc", warehouseDispatchedQty: 0, dispatchNoteItems: [], pickupBatchLines: [] }];
  await add(true);
  expect(m.create).not.toHaveBeenCalled();
  expect(m.update.mock.calls[0][0].data).toMatchObject({ qty: 3 });
  expect(m.update.mock.calls[0][0].data).not.toHaveProperty("unitPriceSale");
  expect(m.quote).toHaveBeenCalledWith(expect.objectContaining({ staffLoyaltySkus: [] }));
});
