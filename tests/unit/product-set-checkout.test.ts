import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ product: vi.fn(), set: vi.fn(), session: vi.fn(), transaction: vi.fn(), customer: vi.fn(), quote: vi.fn(), reservation: vi.fn(), queue: vi.fn(), sync: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { product: { findMany: mocks.product }, productSet: { findMany: mocks.set }, checkoutSession: { findUnique: mocks.session }, $transaction: mocks.transaction, backgroundJob: { upsert: mocks.queue } } }));
vi.mock("@/lib/api/order-access", () => ({ createOrderAccessToken: () => "access", createCheckoutOrderAccessToken: () => "access", hashOrderAccessToken: () => "hash" }));
vi.mock("@/lib/customer-master-sync.server", () => ({ upsertWebCustomer: mocks.customer }));
vi.mock("@/lib/checkout/config", () => ({ isPaymentMethodEnabled: async () => true, resolveDeliveryQuote: mocks.quote }));
vi.mock("@/lib/checkout/first-purchase.server", () => ({ isFirstPurchaseDiscountEligible: async () => false }));
vi.mock("@/lib/pricing/rules", () => ({ getActivePricingRules: async () => [], pricingRuleInputsForProduct: () => ({ linearPromotions: [], loyaltyDiscountPct: 10 }) }));
vi.mock("@/lib/channel-availability.server", () => ({ syncProductChannelAvailability: mocks.sync }));
import { createOrder } from "@/lib/api/checkout";
import { getPublicSets, resolveSetBasket } from "@/lib/product-sets/server";
import { createOrderSchema } from "@/lib/checkout/order-schema";
import { Prisma } from "@prisma/client";

const updatedAt = new Date("2026-10-11T08:00:00Z");
const products = ["TABLE", "CHAIR"].map((sku, i) => ({ id: `p${i}`, sku, name: sku, isActive: true, availableWebManual: true, availableWebAuto: true, articleStatus: "SP", dcAvailableQty: 10, stock: 10, fullPrice: 10000, salePrice: 5000, discountPct: null, supplier: null, categories: [], media: [], actionPrices: [], priceListEntries: [{ price: 10000, validFrom: new Date("2026-01-01"), validTo: null, priceList: { id: "mp", code: "MP", name: "MP", active: true, validFrom: null, validTo: null } }] }));
const definition = { id: "dining", name: "Trpezarija", active: true, updatedAt, components: products.map((p, i) => ({ product: { sku: p.sku }, quantity: i + 1, unitPrice: new Prisma.Decimal(i ? 500.25 : 1000.01) })) };
const input = () => createOrderSchema.parse({ guestEmail: "sets@example.test", lines: [{ sku: "set:dining", qty: 2 }], shipping: { firstName: "Test", lastName: "Kupac", phone: "0601234567", street: "Test ulica", houseNumber: "1", city: "Beograd", postalCode: "11000" }, shippingMethod: "KAMION", paymentMethod: "POUZECE_GOTOVINA", consent: true });
type SavedOrder = Record<string, unknown> & { items: { createMany: { data: Array<{ sku: string; qty: number; unitPriceSale: Prisma.Decimal; productSetName: string }> } } };
let saved: SavedOrder;
let changed: boolean;
beforeEach(() => {
  vi.clearAllMocks(); saved = {} as SavedOrder; changed = false;
  mocks.product.mockResolvedValue(products); mocks.set.mockResolvedValue([definition]); mocks.session.mockResolvedValue(null);
  mocks.customer.mockResolvedValue({ id: "buyer" }); mocks.queue.mockResolvedValue({ id: "job" });
  mocks.quote.mockResolvedValue({ truckAvailable: true, prices: { kamion: 0, kurir: 299 }, assemblyPricesBySku: {}, assemblyPrice: 0 });
  mocks.transaction.mockImplementation(async fn => fn({
    $queryRaw: async (query: { strings?: string[] }) => {
      const sql = query.strings?.join("") ?? String(query);
      if (sql.includes('FROM "ProductSet"')) return [{ id: "dining", active: true, updatedAt: changed ? new Date() : updatedAt }];
      if (sql.includes('FROM "Product"')) return products;
      return [{ seq: 1 }];
    },
    order: { findFirst: async () => null, create: async ({ data }: { data: SavedOrder }) => { saved = { ...data, id: "order" }; return saved; } },
    orderItem: { findMany: async () => products.map(p => ({ id: `item-${p.sku}`, sku: p.sku })), update: mocks.reservation },
    warehouse: { findFirst: async () => ({ id: "dc" }) }, backgroundJob: { upsert: mocks.queue },
  }));
});

describe("set checkout integration", () => {
  it("saves exact set allocations and original atomic basket while reserving component quantities", async () => {
    const result = await createOrder(input(), null);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.subtotal).toBeCloseTo(4001.02, 2);
    expect(saved.checkoutLinesSnapshot).toEqual([{ sku: "set:dining", qty: 2 }]);
    expect(saved.items.createMany.data.map(i => ({ sku: i.sku, qty: i.qty, price: Number(i.unitPriceSale), set: i.productSetName }))).toEqual([{ sku: "TABLE", qty: 2, price: 1000.01, set: "Trpezarija" }, { sku: "CHAIR", qty: 4, price: 500.25, set: "Trpezarija" }]);
    expect(mocks.reservation.mock.calls.map(([call]) => call.data.warehouseReservedQty)).toEqual([2, 4]);
    expect(mocks.quote).toHaveBeenCalledWith(expect.objectContaining({ lines: [{ sku: "set:dining", qty: 2 }] }));
  });
  it("rejects insufficient component stock before creating or reserving an order", async () => {
    mocks.product.mockResolvedValue([products[0], { ...products[1], dcAvailableQty: 3 }]);
    expect(await createOrder(input(), null)).toEqual({ ok: false, error: { code: "OUT_OF_STOCK", sku: "CHAIR" } });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("rejects a set changed between price calculation and transaction", async () => {
    changed = true;
    const result = await createOrder(input(), null);
    expect(result).toMatchObject({ ok: false, error: { code: "INVALID_SET" } });
    expect(mocks.reservation).not.toHaveBeenCalled();
  });
  it("rejects standalone overlap without applying discounted component prices", async () => {
    const request = input(); request.lines.push({ sku: "CHAIR", qty: 1 });
    expect(await createOrder(request, null)).toMatchObject({ ok: false, error: { code: "INVALID_SET" } });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});

it("replays an existing set order even after its definition is deactivated", async () => {
  await createOrder(input(), null);
  const existing = { ...saved, supplierFulfillments: [], items: saved.items.createMany.data, voucherDiscount: 0, firstPurchaseDiscount: 0, savedCardDiscount: 0 };
  mocks.session.mockResolvedValue({ order: existing });
  mocks.set.mockResolvedValue([]);
  const request = input(); request.checkoutSessionId = "repeat-set-checkout-123";
  const result = await createOrder(request, null);
  expect(result).toMatchObject({ ok: true, data: { id: "order" } });
  expect(mocks.set).toHaveBeenCalledOnce();
  expect(mocks.transaction).toHaveBeenCalledOnce();
  request.lines[0].qty = 3;
  expect(await createOrder(request, null)).toMatchObject({ ok: false, error: { code: "CHECKOUT_SESSION_MISMATCH" } });
});

it("hides a published set if a component is no longer public", async () => {
  mocks.set.mockResolvedValue([{ ...definition, components: definition.components.map((c, index) => ({ ...c, productId: products[index].id, product: products[index] })) }]);
  mocks.product.mockResolvedValue([products[0]]);
  expect(await getPublicSets()).toEqual([]);
});

it("preserves the ordinary quote path and its existing quantity limits", async () => {
  const lines = [{ sku: "TABLE", qty: 999 }];
  const resolved = await resolveSetBasket(lines);
  expect(resolved.lines).toBe(lines);
  expect(resolved.prices.size).toBe(0);
  expect(mocks.set).not.toHaveBeenCalled();
});
