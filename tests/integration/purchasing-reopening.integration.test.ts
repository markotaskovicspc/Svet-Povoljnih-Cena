import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { reopenPurchasingDocument, postPurchasingCorrection } from "@/lib/admin/purchasing-reopening.server";
import { readPurchasingReopening } from "@/lib/admin/purchasing-reopening";
import { postInboundInvoice, saveInboundInvoice, cancelInboundInvoice, lockInboundInvoice } from "@/lib/admin/inbound-invoice.server";
import { postPurchaseOrder, updatePurchaseOrderItem } from "@/lib/admin/po";

const session = vi.hoisted(() => ({ id: "", role: "SUPER" }));
vi.mock("@/lib/auth/session", () => ({ getCurrentAdmin: async () => session }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(url); } }));
vi.mock("@/lib/pricing/rules", () => ({ getActivePricingRules: async () => ({ loyaltyRules: [], linearPromotions: [] }) }));

const run = randomUUID().slice(0, 8);
const orders: string[] = [], products: string[] = [];
let supplierId = "", warehouseId = "";

async function fixture(withInvoice = true) {
  const key = `${run}-${orders.length}`;
  const product = await db.product.create({ data: { sku: `REOPEN-${key}`, slug: `reopen-${key}`, name: "Ispravka", description: "Test", fullPrice: 200, stock: 40, cogs: 100, supplierId, containerQty: 690, packQty: 1 } });
  products.push(product.id);
  await db.warehouseStock.create({ data: { warehouseId, productId: product.id, qty: 40 } });
  const lockedAt = new Date();
  const order = await db.purchaseOrder.create({ data: { number: `REOPEN-${key}`, supplierId, receivingWarehouseId: warehouseId, status: "RECEIVED", currency: "RSD", exchangeRate: 1, lockedAt, postedAt: lockedAt, cogsBookedAt: lockedAt, cogsBookingSnapshot: { version: 1, products: [{ productId: product.id, sku: product.sku, stock: 30, cogs: 100 }] }, items: { create: { productId: product.id, sku: product.sku, name: product.name, qty: 10, receivedQty: 10, purchasePrice: 100, customsRate: 0, packQty: 1, totalVolume: 1, totalWeight: 1, freightAllocated: 0, additionalCostAllocated: 0 } } }, include: { items: true } });
  orders.push(order.id);
  const invoice = withInvoice ? await db.inboundInvoice.create({ data: { number: `REOPEN-INV-${key}`, purchaseOrderId: order.id, supplierId, warehouseId, status: "POSTED", cogsStatus: "LOCKED", lockedAt, invoiceDate: new Date(), currency: "RSD", value: 1000, invoiceValueRsd: 1000, customsValueRsd: 0, transportValueRsd: 0, otherRelatedCostsRsd: 0, netValue: 1000, vatValue: 200, grossValue: 1200 } }) : null;
  return { product, order, invoice, lockedAt, itemId: order.items[0].id };
}

async function reopen(f: Awaited<ReturnType<typeof fixture>>, kind: "invoice" | "purchase-order" = "invoice") {
  await reopenPurchasingDocument({ kind, id: kind === "invoice" ? f.invoice!.id : f.order.id, lockedAt: f.lockedAt.toISOString() }, session.id);
  return readPurchasingReopening((await db.purchaseOrder.findUniqueOrThrow({ where: { id: f.order.id } })).cogsBookingSnapshot)!;
}

async function save(f: Awaited<ReturnType<typeof fixture>>, value: number) {
  await saveInboundInvoice({ id: f.invoice!.id, number: f.invoice!.number, receiptDate: new Date(), purchaseOrderId: f.order.id, warehouseId, currency: "RSD", exchangeRate: 1, invoiceValue: value, customsValueRsd: 0, transportValueRsd: 0, otherRelatedCostsRsd: 0, notes: "Ispravka" });
}

describe("purchasing reopening against isolated PostgreSQL", () => {
  beforeAll(async () => {
    const admin = await db.adminUser.create({ data: { email: `reopen-${run}@example.invalid`, passwordHash: "unused", role: "SUPER", firstName: "Test", lastName: "Reopen" } });
    session.id = admin.id;
    supplierId = (await db.supplier.create({ data: { code: `REOPEN-${run}`, name: "Test dobavljač", currency: "RSD" } })).id;
    warehouseId = (await db.warehouse.create({ data: { code: `REOPEN-${run}`, name: "Test prijem", active: true } })).id;
  });

  afterAll(async () => {
    await db.inboundInvoice.deleteMany({ where: { purchaseOrderId: { in: orders } } });
    await db.purchaseOrder.deleteMany({ where: { id: { in: orders } } });
    await db.stockMovement.deleteMany({ where: { productId: { in: products } } });
    await db.product.deleteMany({ where: { id: { in: products } } });
    if (supplierId) await db.supplier.delete({ where: { id: supplierId } });
    if (warehouseId) await db.warehouse.delete({ where: { id: warehouseId } });
    if (session.id) await db.adminUser.delete({ where: { id: session.id } });
    await db.$disconnect();
  });

  it("denies OPS before changing documents", async () => {
    const f = await fixture(); session.role = "OPS";
    try { await expect(reopen(f)).rejects.toThrow("forbidden"); } finally { session.role = "SUPER"; }
    expect((await db.purchaseOrder.findUniqueOrThrow({ where: { id: f.order.id } })).lockedAt).not.toBeNull();
  });

  it.each(["invoice", "purchase-order"] as const)("opens the pair from %s while keeping booked quantities and COGS", async kind => {
    const f = await fixture();
    const baseline = await reopen(f, kind);
    expect(baseline.products).toEqual([{ productId: f.product.id, sku: f.product.sku, qty: 10, costRsd: 1000 }]);
    expect((await db.purchaseOrder.findUniqueOrThrow({ where: { id: f.order.id } }))).toMatchObject({ lockedAt: null, status: "RECEIVED" });
    expect((await db.inboundInvoice.findUniqueOrThrow({ where: { id: f.invoice!.id } }))).toMatchObject({ lockedAt: null, status: "RECEIVED" });
    expect((await db.product.findUniqueOrThrow({ where: { id: f.product.id } })).stock).toBe(40);
    expect(await db.stockMovement.count({ where: { productId: f.product.id } })).toBe(0);
    expect((await reopen(f, kind)).token).toBe(baseline.token);
    await expect(cancelInboundInvoice(f.invoice!.id)).rejects.toThrow("već primljenom");
    await expect(lockInboundInvoice(f.invoice!.id)).rejects.toThrow("robnog prijema");
  });

  it("posts only quantity/cost differences and keeps retries and a second reopening idempotent", async () => {
    const f = await fixture(); await reopen(f);
    await updatePurchaseOrderItem({ id: f.itemId, qty: 12, purchasePrice: 120, customsRate: 0, calcRetailPrice: null });
    await save(f, 1440);
    const result = await postInboundInvoice(f.invoice!.id, session.id);
    expect(result.correction).toBe(true);
    const product = await db.product.findUniqueOrThrow({ where: { id: f.product.id } });
    expect({ stock: product.stock, cogs: Number(product.cogs), incoming: product.incomingStock }).toEqual({ stock: 42, cogs: 105.71, incoming: 0 });
    expect((await db.purchaseOrderItem.findUniqueOrThrow({ where: { id: f.itemId } })).receivedQty).toBe(12);
    await postInboundInvoice(f.invoice!.id, session.id);
    expect(await db.stockMovement.count({ where: { productId: f.product.id } })).toBe(1);
    expect((await db.stockMovement.findFirstOrThrow({ where: { productId: f.product.id } })).qty).toBe(2);
    const invoice = await db.inboundInvoice.findUniqueOrThrow({ where: { id: f.invoice!.id } });
    await reopenPurchasingDocument({ kind: "invoice", id: invoice.id, lockedAt: invoice.lockedAt!.toISOString() }, session.id);
    await postInboundInvoice(invoice.id, session.id);
    const unchanged = await db.product.findUniqueOrThrow({ where: { id: product.id } });
    expect({ stock: unchanged.stock, cogs: Number(unchanged.cogs) }).toEqual({ stock: 42, cogs: 105.71 });
    expect(await db.stockMovement.count({ where: { productId: product.id } })).toBe(1);
    await expect(reopen(f)).rejects.toThrow("međuvremenu");
  });

  it("rolls back the entire post when a reduction exceeds available warehouse stock", async () => {
    const f = await fixture(); await reopen(f);
    await updatePurchaseOrderItem({ id: f.itemId, qty: 1, purchasePrice: 100, customsRate: 0, calcRetailPrice: null });
    await save(f, 100);
    await db.warehouseStock.update({ where: { warehouseId_productId: { warehouseId, productId: f.product.id } }, data: { qty: 2 } });
    await expect(postInboundInvoice(f.invoice!.id, session.id)).rejects.toThrow("zaliha");
    const order = await db.purchaseOrder.findUniqueOrThrow({ where: { id: f.order.id } });
    expect(order.lockedAt).toBeNull();
    expect(readPurchasingReopening(order.cogsBookingSnapshot)).not.toBeNull();
    expect((await db.inboundInvoice.findUniqueOrThrow({ where: { id: f.invoice!.id } })).lockedAt).toBeNull();
    expect((await db.product.findUniqueOrThrow({ where: { id: f.product.id } })).stock).toBe(40);
    expect(await db.stockMovement.count({ where: { productId: f.product.id } })).toBe(0);
  });

  it("rejects a different warehouse or PO and never cancels the physical receipt", async () => {
    const f = await fixture(); await reopen(f);
    await expect(saveInboundInvoice({ id: f.invoice!.id, number: f.invoice!.number, receiptDate: new Date(), purchaseOrderId: "different", warehouseId, currency: "RSD", exchangeRate: 1, invoiceValue: 1000, customsValueRsd: 0, transportValueRsd: 0, otherRelatedCostsRsd: 0, notes: null })).rejects.toThrow("Veza");
  });

  it("serializes simultaneous posts without duplicate movements", async () => {
    const f = await fixture(); const baseline = await reopen(f);
    await updatePurchaseOrderItem({ id: f.itemId, qty: 12, purchasePrice: 100, customsRate: 0, calcRetailPrice: null }); await save(f, 1200);
    await Promise.all([postPurchasingCorrection(f.order.id, session.id, baseline.token), postPurchasingCorrection(f.order.id, session.id, baseline.token)]);
    expect((await db.product.findUniqueOrThrow({ where: { id: f.product.id } })).stock).toBe(42);
    expect(await db.stockMovement.count({ where: { productId: f.product.id } })).toBe(1);
  });

  it("also supports a legacy received PO without an invoice", async () => {
    const f = await fixture(false); await reopen(f, "purchase-order");
    await updatePurchaseOrderItem({ id: f.itemId, qty: 8, purchasePrice: 100, customsRate: 0, calcRetailPrice: null });
    await postPurchaseOrder(f.order.id, session.id);
    expect((await db.product.findUniqueOrThrow({ where: { id: f.product.id } })).stock).toBe(38);
    expect((await db.stockMovement.findFirstOrThrow({ where: { productId: f.product.id } })).qty).toBe(-2);
  });

  it("preserves historical customs and logistics when article master data changes", async () => {
    const f = await fixture(); await reopen(f);
    await db.product.update({ where: { id: f.product.id }, data: { customsRate: 25, containerQty: 100 } });
    await postInboundInvoice(f.invoice!.id, session.id);
    const item = await db.purchaseOrderItem.findUniqueOrThrow({ where: { id: f.itemId } });
    expect(Number(item.customsRate)).toBe(0);
    expect(Number(item.totalVolume)).toBe(1);
    expect(Number((await db.product.findUniqueOrThrow({ where: { id: f.product.id } })).cogs)).toBe(100);
  });

  it("removes an old line and receives only the replacement product", async () => {
    const f = await fixture(); await reopen(f);
    const next = await db.product.create({ data: { sku: `REPLACE-${run}`, slug: `replace-${run}`, name: "Zamena", description: "Test", supplierId, fullPrice: 400, stock: 0, containerQty: 690 } });
    products.push(next.id);
    await db.purchaseOrderItem.delete({ where: { id: f.itemId } });
    await db.purchaseOrderItem.create({ data: { purchaseOrderId: f.order.id, productId: next.id, sku: next.sku, name: next.name, qty: 5, purchasePrice: 200, customsRate: 0, totalVolume: 0.5, totalWeight: 1 } });
    await save(f, 1000); await postInboundInvoice(f.invoice!.id, session.id);
    const original = await db.product.findUniqueOrThrow({ where: { id: f.product.id } });
    const replacement = await db.product.findUniqueOrThrow({ where: { id: next.id } });
    expect({ stock: original.stock, cogs: Number(original.cogs) }).toEqual({ stock: 30, cogs: 100 });
    expect({ stock: replacement.stock, cogs: Number(replacement.cogs) }).toEqual({ stock: 5, cogs: 200 });
    expect(await db.stockMovement.count({ where: { productId: { in: [original.id, next.id] } } })).toBe(2);
  });

  it("unlocks posted documents before receipt without inventing a receipt or changing their order status", async () => {
    const f = await fixture();
    await db.purchaseOrder.update({ where: { id: f.order.id }, data: { status: "CONFIRMED", cogsBookedAt: null } });
    await reopen(f);
    const order = await db.purchaseOrder.findUniqueOrThrow({ where: { id: f.order.id } });
    expect(order).toMatchObject({ status: "CONFIRMED", lockedAt: null });
    expect(readPurchasingReopening(order.cogsBookingSnapshot)).toBeNull();
    expect((await db.product.findUniqueOrThrow({ where: { id: f.product.id } })).stock).toBe(40);
  });
});
