import "server-only";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { adjustInventory } from "@/lib/inventory";
import { resolveFiscalReservationPosting } from "@/lib/reservation-stock";
import { syncProductChannelAvailability } from "@/lib/channel-availability.server";

const snapshotSchema = z.array(z.object({
  id: z.string(), productId: z.string().nullable(), sku: z.string(), qty: z.number().int().positive(),
  warehouseId: z.string().nullable(), warehouseReservedQty: z.number().int().nonnegative(), supplierReservedQty: z.number().int().nonnegative(),
}));

/** Remote submission and inventory commit have separate recovery paths: stock failures never resend an invoice. */
export async function ensureSefInventoryPosted(id: string) {
  const document = await db.sefDocument.findUniqueOrThrow({ where: { id } });
  if (document.environment !== "production" || document.direction !== "OUT" || !document.sentAt || !document.orderId || document.inventoryPostedAt) return;
  const snapshot = snapshotSchema.parse(document.inventorySnapshot);
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${document.orderId} FOR UPDATE`;
    const latest = await tx.sefDocument.findUniqueOrThrow({ where: { id } });
    if (latest.inventoryPostedAt) return;
    await tx.$queryRaw(Prisma.sql`SELECT id FROM "OrderItem" WHERE id IN (${Prisma.join(snapshot.map(item => item.id))}) ORDER BY id FOR UPDATE`);
    const current = await tx.orderItem.findMany({ where: { orderId: document.orderId! }, include: { stockMovements: { select: { qty: true } } } });
    for (const line of snapshot) {
      const item = current.find(item => item.id === line.id);
      if (!item || item.qty !== line.qty || item.productId !== line.productId || item.warehouseId !== line.warehouseId || item.warehouseReservedQty !== line.warehouseReservedQty || item.supplierReservedQty !== line.supplierReservedQty) throw new Error("SEF faktura je poslata, ali rezervacija je promenjena. Proverite lager; faktura se neće slati ponovo.");
      if (line.warehouseReservedQty > 0) {
        if (!line.productId) throw new Error("SEF stavka nema proizvod za knjiženje lagera.");
        const posting = resolveFiscalReservationPosting({ movementQtys: item.stockMovements.map(m => m.qty), warehouseId: line.warehouseId });
        if (posting.type === "debit") await adjustInventory(tx, { idempotencyKey: `sef-sale:${id}:${line.id}`, productId: line.productId, sku: line.sku, warehouseId: posting.warehouseId, qtyDelta: -line.warehouseReservedQty, kind: "SALE_RESERVATION", orderId: document.orderId, orderItemId: line.id, note: `SEF faktura ${document.number}` });
      }
      await tx.orderItem.update({ where: { id: line.id }, data: { warehouseReservedQty: 0, supplierReservedQty: 0 } });
      if (line.productId) await syncProductChannelAvailability(tx, line.productId);
    }
    await tx.sefDocument.update({ where: { id }, data: { inventoryPostedAt: new Date() } });
  }, { maxWait: 10_000, timeout: 30_000 });
}
