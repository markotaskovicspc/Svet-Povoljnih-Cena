import "server-only";

import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { adjustInventory } from "@/lib/inventory";
import { syncProductChannelAvailability } from "@/lib/channel-availability.server";
import { resolveFiscalReservationPosting } from "@/lib/reservation-stock";

async function postIssuedFiscalSaleInventory(
  tx: Prisma.TransactionClient,
  fiscalDocumentId: string,
) {
  await tx.$queryRaw(
    Prisma.sql`SELECT "id" FROM "FiscalDocument" WHERE "id" = ${fiscalDocumentId} FOR UPDATE`,
  );
  const document = await tx.fiscalDocument.findUnique({
    where: { id: fiscalDocumentId },
    select: {
      id: true,
      kind: true,
      status: true,
      order: { select: { id: true, number: true } },
      lines: {
        orderBy: { id: "asc" },
        select: {
          id: true,
          orderItemId: true,
          productId: true,
          sku: true,
          qty: true,
        },
      },
    },
  });
  if (!document) throw new Error("Fiskalni dokument ne postoji.");
  if (document.kind !== "SALE" || document.status !== "ISSUED") {
    throw new Error("Samo izdat fiskalni račun prodaje može da knjiži lager.");
  }

  const orderItemIds = document.lines
    .map((line) => line.orderItemId)
    .filter((id): id is string => Boolean(id));
  if (orderItemIds.length) {
    await tx.$queryRaw(
      Prisma.sql`
        SELECT "id"
        FROM "OrderItem"
        WHERE "id" IN (${Prisma.join(orderItemIds)})
        ORDER BY "id"
        FOR UPDATE
      `,
    );
  }
  const items = await tx.orderItem.findMany({
    where: { id: { in: orderItemIds } },
    select: {
      id: true,
      productId: true,
      warehouseId: true,
      warehouseReservedQty: true,
      supplierReservedQty: true,
      stockMovements: {
        select: { qty: true },
      },
    },
  });
  const itemById = new Map(items.map((item) => [item.id, item]));
  let warehouseLines = 0;

  for (const line of document.lines) {
    if (!line.orderItemId || !line.productId) continue;
    const item = itemById.get(line.orderItemId);
    if (!item || item.productId !== line.productId) {
      throw new Error(`Stavka porudžbine za ${line.sku} nije usklađena.`);
    }
    const warehouseQty = Math.min(line.qty, item.warehouseReservedQty);
    // A retry, a historical fiscal document, or a supplier-only part can have
    // no remaining owned-warehouse reservation. The transaction below clears
    // reservations atomically, so zero is already-posted/no-owned-stock work.
    if (warehouseQty === 0) continue;

    const posting = resolveFiscalReservationPosting({
      movementQtys: item.stockMovements.map((movement) => movement.qty),
      warehouseId: item.warehouseId,
    });
    if (posting.type === "debit") {
      await adjustInventory(tx, {
        idempotencyKey: `fiscal-sale:${document.id}:${line.id}`,
        warehouseId: posting.warehouseId,
        productId: line.productId,
        sku: line.sku,
        qtyDelta: -warehouseQty,
        kind: "SALE_RESERVATION",
        orderId: document.order.id,
        orderItemId: item.id,
        fiscalDocumentId: document.id,
        note: `Fiskalizacija porudžbine ${document.order.number}`,
      });
    }

    const remaining = item.warehouseReservedQty - warehouseQty;
    const updated = await tx.orderItem.updateMany({
      where: {
        id: item.id,
        warehouseReservedQty: { gte: warehouseQty },
      },
      data: {
        warehouseReservedQty: { decrement: warehouseQty },
      },
    });
    if (updated.count !== 1) {
      throw new Error(`DC rezervacija za ${line.sku} je promenjena.`);
    }
    // One order item can be split across several fiscal lines (for example,
    // when price tiers differ). Keep the locked in-memory snapshot in sync so
    // a later line cannot consume the same reservation twice.
    item.warehouseReservedQty = remaining;
    await syncProductChannelAvailability(tx, line.productId);
    warehouseLines++;
  }

  return { posted: true, warehouseLines };
}

export async function ensureIssuedFiscalSaleInventoryPosted(
  fiscalDocumentId: string,
) {
  return db.$transaction(
    (tx) => postIssuedFiscalSaleInventory(tx, fiscalDocumentId),
    { maxWait: 10_000, timeout: 30_000 },
  );
}
