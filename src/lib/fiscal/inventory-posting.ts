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
      qty: true,
      productId: true,
      warehouseId: true,
      warehouseReservedQty: true,
      supplierReservedQty: true,
      stockMovements: {
        select: { qty: true, fiscalDocumentId: true },
      },
    },
  });
  const itemById = new Map(items.map((item) => [item.id, item]));
  const issuedQuantities = orderItemIds.length
    ? await tx.fiscalDocumentLine.groupBy({
        by: ["orderItemId"],
        where: {
          orderItemId: { in: orderItemIds },
          fiscalDocument: { is: { kind: "SALE", status: "ISSUED" } },
        },
        _sum: { qty: true },
      })
    : [];
  const issuedQtyByItem = new Map(
    issuedQuantities.flatMap((row) =>
      row.orderItemId ? [[row.orderItemId, row._sum.qty ?? 0] as const] : [],
    ),
  );
  const documentLinesByItem = new Map<
    string,
    typeof document.lines
  >();
  for (const line of document.lines) {
    if (!line.orderItemId || !line.productId) continue;
    const lines = documentLinesByItem.get(line.orderItemId) ?? [];
    lines.push(line);
    documentLinesByItem.set(line.orderItemId, lines);
  }
  let warehouseLines = 0;

  for (const [orderItemId, lines] of documentLinesByItem) {
    const item = itemById.get(orderItemId);
    const firstLine = lines[0];
    if (
      !item ||
      !firstLine ||
      lines.some((line) => line.productId !== item.productId)
    ) {
      throw new Error(
        `Stavka porudžbine za ${firstLine?.sku ?? orderItemId} nije usklađena.`,
      );
    }

    const documentQty = lines.reduce((sum, line) => sum + line.qty, 0);
    const previouslyPostedWarehouseQty = item.stockMovements.reduce(
      (sum, movement) =>
        movement.fiscalDocumentId && movement.qty < 0
          ? sum - movement.qty
          : sum,
      0,
    );
    const availableWarehouseAllocation = Math.max(
      item.warehouseReservedQty - previouslyPostedWarehouseQty,
      0,
    );
    let warehouseQty = 0;
    if (availableWarehouseAllocation > 0) {
      const posting = resolveFiscalReservationPosting({
        // Fiscal sale movements belong to earlier posting attempts/documents;
        // they must not make a new-model reservation look like a legacy
        // reservation that had already reduced physical stock at checkout.
        movementQtys: item.stockMovements
          .filter((movement) => !movement.fiscalDocumentId)
          .map((movement) => movement.qty),
        warehouseId: item.warehouseId,
      });
      if (posting.type === "debit") {
        warehouseQty = Math.min(documentQty, availableWarehouseAllocation);
        await adjustInventory(tx, {
          idempotencyKey: `fiscal-sale:${document.id}:${item.id}`,
          warehouseId: posting.warehouseId,
          productId: item.productId!,
          sku: firstLine.sku,
          qtyDelta: -warehouseQty,
          kind: "SALE_RESERVATION",
          orderId: document.order.id,
          orderItemId: item.id,
          fiscalDocumentId: document.id,
          note: `Fiskalizacija porudžbine ${document.order.number}`,
        });
        warehouseLines++;
      }
    }

    const fullyFiscalized = (issuedQtyByItem.get(item.id) ?? 0) >= item.qty;
    if (
      fullyFiscalized &&
      (item.warehouseReservedQty > 0 || item.supplierReservedQty > 0)
    ) {
      // The database constraint deliberately permits only a complete active
      // allocation or a completely released one. Clear both sides in one
      // statement after all price-tier lines for the item have been posted.
      const updated = await tx.orderItem.updateMany({
        where: {
          id: item.id,
          warehouseReservedQty: item.warehouseReservedQty,
          supplierReservedQty: item.supplierReservedQty,
        },
        data: {
          warehouseReservedQty: 0,
          supplierReservedQty: 0,
        },
      });
      if (updated.count !== 1) {
        throw new Error(`Rezervacija za ${firstLine.sku} je promenjena.`);
      }
    }

    if (warehouseQty > 0 || fullyFiscalized) {
      await syncProductChannelAvailability(tx, item.productId!);
    }
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
