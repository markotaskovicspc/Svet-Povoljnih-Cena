import { expect, it } from "vitest";
import { db } from "@/lib/db";
import { adjustInventory } from "@/lib/inventory";
import { configureAnanasInventory, postAnanasDocumentInventory, ANANAS_INVENTORY_KEY } from "@/lib/ananas/inventory.server";

it("posts historical Ananas sales/refunds once, permits a scoped minus, and preserves DC availability", async () => {
  const prefix = `QA-ANANAS-${Date.now()}`;
  const sourceSku = "9876", canonicalSku = "910876";
  const warehouse = await db.warehouse.create({ data: { code: prefix, name: "Ananas" } });
  const product = await db.product.create({ data: { sku: canonicalSku, slug: prefix.toLowerCase(), name: prefix, description: "QA", fullPrice: 100, stock: 10 } });
  const document = (kind: string, qty: number, suffix: string, sku = sourceSku) => db.ananasDocument.create({ data: {
    kind, externalId: `${prefix}-${suffix}`, fiscalNumber: `${prefix}-${suffix}`, orderNumber: prefix, suborderNumber: prefix,
    issuedAt: new Date("2025-06-02T10:00:00Z"), invoicedAt: new Date("2025-06-02T10:00:00Z"), gross: 100, net: 100, vat: 0,
    paymentMethods: "COD", items: [{ sku, name: "Sto", quantity: qty, gross: 100 }],
  } });
  try {
    await configureAnanasInventory(true, true, "QA");
    const sale = await document("SALE", 20, "SALE");
    await Promise.all([postAnanasDocumentInventory(sale.id), postAnanasDocumentInventory(sale.id)]);
    expect(await db.stockMovement.count({ where: { productId: product.id } })).toBe(1);
    expect((await db.stockMovement.findFirstOrThrow({ where: { productId: product.id } })).sku).toBe(canonicalSku);
    expect((await db.warehouseStock.findUniqueOrThrow({ where: { warehouseId_productId: { warehouseId: warehouse.id, productId: product.id } } })).qty).toBe(-20);
    const dc = await db.warehouse.findFirstOrThrow({ where: { isDefault: true } });
    expect((await db.warehouseStock.findUniqueOrThrow({ where: { warehouseId_productId: { warehouseId: dc.id, productId: product.id } } })).qty).toBe(10);
    // Negative aggregate must not prevent an ordinary sale from a stocked DC.
    await db.$transaction(tx => adjustInventory(tx, { idempotencyKey: `${prefix}-DC`, warehouseId: dc.id, productId: product.id, qtyDelta: -2, kind: "SALE_RESERVATION", note: "QA" }));
    const archivedAt = new Date("2026-07-22T15:04:00Z");
    await db.product.update({ where: { id: product.id }, data: { deletedAt: archivedAt } });
    const refund = await document("REFUND", 5, "REFUND");
    await postAnanasDocumentInventory(refund.id);
    expect((await db.product.findUniqueOrThrow({ where: { id: product.id } })).deletedAt).toEqual(archivedAt);
    expect((await db.warehouseStock.findUniqueOrThrow({ where: { warehouseId_productId: { warehouseId: warehouse.id, productId: product.id } } })).qty).toBe(-15);
    await db.$transaction(tx => adjustInventory(tx, { idempotencyKey: `${prefix}-RECEIPT`, warehouseId: warehouse.id, productId: product.id, qtyDelta: 16, kind: "PURCHASE_RECEIPT", note: "QA" }));
    expect((await db.warehouseStock.findUniqueOrThrow({ where: { warehouseId_productId: { warehouseId: warehouse.id, productId: product.id } } })).qty).toBe(1);
    await configureAnanasInventory(true, false, "QA");
    const tooMany = await document("SALE", 2, "STRICT");
    await expect(postAnanasDocumentInventory(tooMany.id)).rejects.toThrow(/Nema dovoljno/);
    expect((await db.ananasDocument.findUniqueOrThrow({ where: { id: tooMany.id } })).inventoryPostedAt).toBeNull();
    const missing = await document("SALE", 1, "MISSING", `${prefix}-UNKNOWN`);
    await expect(postAnanasDocumentInventory(missing.id)).rejects.toThrow(/nisu pronađeni/);
    await configureAnanasInventory(false, true, "QA");
    expect((await postAnanasDocumentInventory(missing.id)).reason).toBe("DISABLED");
  } finally {
    await db.adminSetting.deleteMany({ where: { key: ANANAS_INVENTORY_KEY } });
    await db.ananasDocument.deleteMany({ where: { orderNumber: prefix } });
    await db.stockMovement.deleteMany({ where: { productId: product.id } });
    await db.warehouseStock.deleteMany({ where: { productId: product.id } });
    await db.product.delete({ where: { id: product.id } });
    await db.warehouse.delete({ where: { id: warehouse.id } });
  }
});
