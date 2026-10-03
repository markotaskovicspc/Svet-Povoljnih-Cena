import { expect, it } from "vitest";
import { db } from "@/lib/db";
import { loadEligibleOrders, setPickupPackageReady } from "@/lib/admin/pickup-batch.server";
import { buildPickupPrintRows } from "@/lib/admin/pickup-print";
import { getPickingSession } from "@/lib/admin/picking.server";

it("loads CITY LINE into picking once, preserves 16 units, and requires measured boxes before readiness", async () => {
  const prefix = `CARTON-${Date.now()}`;
  const warehouse = await db.warehouse.create({ data: { code: `${prefix}-DC`, name: prefix, active: true, isDefault: true } });
  const actor = await db.adminUser.create({ data: { email: `${prefix}@example.invalid`, passwordHash: "unused", role: "OPS" } });
  const product = await db.product.create({ data: {
    sku: "110174", slug: prefix.toLowerCase(), name: "Trpezarijska stolica CITY LINE", description: "Test",
    fullPrice: 1000, courierUnitsPerBox: 2,
    unitPackWidthCm: 53, unitPackDepthCm: 45, unitPackHeightCm: 51, grossWeightKg: 3,
  } });
  const batch = await db.pickupBatch.create({ data: { number: prefix, provider: "X_EXPRESS", courier: "COURIER_SMALL" } });
  const order = await db.order.create({ data: {
    number: prefix, status: "KREIRANO", subtotal: 16000, total: 16300, shipping: 300,
    shippingMethod: "KURIR", paymentMethod: "POUZECE_GOTOVINA",
    shipFirstName: "Test", shipLastName: "Picking", shipPhone: "0601234567",
    shipStreet: "Test 1", shipCity: "Novi Sad", shipPostalCode: "21000", termsAcceptedAt: new Date(),
    items: { create: { productId: product.id, sku: product.sku, name: product.name, qty: 16,
      warehouseId: warehouse.id, warehouseReservedQty: 16, unitPriceFull: 1000, unitPriceSale: 1000 } },
  } });
  expect(await loadEligibleOrders(batch.id, actor.id, [order.id])).toMatchObject({ orderCount: 1, lineCount: 8, skippedInvalidDimensionsCount: 0 });
  expect(await loadEligibleOrders(batch.id, actor.id, [order.id])).toMatchObject({ orderCount: 0, lineCount: 0 });
  const lines = await db.pickupBatchLine.findMany({ where: { batchId: batch.id }, include: { orderItem: true } });
  expect(lines).toHaveLength(8);
  expect(lines.every(line => line.widthCm === null && line.weightKg === null && line.warehouseReadyAt === null)).toBe(true);
  expect(buildPickupPrintRows(lines)).toMatchObject([{ sku: "110174", quantity: 16, packageCount: 8 }]);
  expect((await getPickingSession(batch.id)).rows).toMatchObject([{ sku: "110174", quantity: 16 }]);
  await expect(setPickupPackageReady(batch.id, lines[0].id, true, actor.id)).rejects.toThrow();
  expect(await db.shipment.count({ where: { orderId: order.id } })).toBe(0);
  expect((await db.orderItem.findFirstOrThrow({ where: { orderId: order.id } })).warehouseReservedQty).toBe(16);
});
