import "server-only";

import { Prisma, type PickupBatchStatus } from "@prisma/client";
import { db } from "@/lib/db";
import {
  createShipmentForOrder,
  getSelectedSmallParcelProvider,
} from "@/lib/courier";
import {
  requireXExpressShipmentConfig,
  X_EXPRESS_PROVIDER,
} from "@/lib/x-express/config";
import {
  isPickupBatchEditable,
  nextPickupBatchNumber,
  PICKUP_BATCH_EXTERNAL_BLOCK_REASON,
} from "@/lib/admin/pickup-batch";

type Transaction = Prisma.TransactionClient;

const TRANSACTION_OPTIONS = {
  isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  maxWait: 10_000,
  timeout: 30_000,
} as const;

export async function getPickupPostingAvailability() {
  if ((await getSelectedSmallParcelProvider()) !== "X_EXPRESS") {
    return {
      available: false as const,
      reason: PICKUP_BATCH_EXTERNAL_BLOCK_REASON,
      provider: "MYGLS" as const,
    };
  }
  try {
    requireXExpressShipmentConfig(true);
    return {
      available: true as const,
      reason: null,
      provider: "X_EXPRESS" as const,
    };
  } catch (error) {
    return {
      available: false as const,
      reason:
        error instanceof Error
          ? error.message
          : "X Express konfiguracija nije kompletna.",
      provider: "X_EXPRESS" as const,
    };
  }
}

export async function createPickupBatch() {
  const availability = await getPickupPostingAvailability();
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return await db.$transaction(async (tx) => {
        const year = new Date().getFullYear();
        const existing = await tx.pickupBatch.findMany({
          where: { number: { startsWith: `PRE-${year}-` } },
          select: { number: true },
        });
        return tx.pickupBatch.create({
          data: {
            number: nextPickupBatchNumber(
              existing.map((row) => row.number),
              year,
            ),
            courier: "COURIER_SMALL",
            configurationIssue: availability.reason,
          },
        });
      }, TRANSACTION_OPTIONS);
    } catch (error) {
      if (!isRetryableCreateError(error) || attempt === 3) throw error;
    }
  }
  throw new Error("Broj naloga za preuzimanje nije mogao da se generiše.");
}

export async function savePickupDate(batchId: string, pickupDate: Date) {
  if (!batchId) throw new Error("Nalog za preuzimanje nije izabran.");
  if (Number.isNaN(pickupDate.getTime())) {
    throw new Error("Datum preuzimanja nije ispravan.");
  }
  const batch = await db.pickupBatch.findUnique({
    where: { id: batchId },
    select: { id: true, status: true },
  });
  assertEditableBatch(batch);
  return db.pickupBatch.update({
    where: { id: batchId },
    data: { pickupDate },
  });
}

export async function loadEligibleOrders(
  batchId: string,
  actorId: string,
) {
  return db.$transaction(async (tx) => {
    await lockBatch(tx, batchId);
    const batch = await tx.pickupBatch.findUnique({
      where: { id: batchId },
      select: { id: true, status: true, number: true },
    });
    assertEditableBatch(batch);

    const dc = await findDcWarehouse(tx);
    if (!dc) {
      throw new Error(
        "DC magacin nije podešen. Označite aktivni magacin kao podrazumevani DC.",
      );
    }

    const candidates = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT orders."id"
      FROM "Order" AS orders
      WHERE orders."status" = 'KREIRANO'
        AND orders."shippingMethod" = 'KURIR'
        AND EXISTS (
          SELECT 1
          FROM "OrderItem" AS items
          WHERE items."orderId" = orders."id"
            AND items."warehouseId" = ${dc.id}
        )
        AND NOT EXISTS (
          SELECT 1
          FROM "PickupBatchLine" AS pickup_lines
          WHERE pickup_lines."orderId" = orders."id"
        )
      ORDER BY orders."number" ASC
      FOR UPDATE OF orders SKIP LOCKED
      LIMIT 2000
    `);
    const orderIds = candidates.map((row) => row.id);
    if (!orderIds.length) return { orderCount: 0, lineCount: 0 };

    const items = await tx.orderItem.findMany({
      where: {
        orderId: { in: orderIds },
        warehouseId: dc.id,
      },
      select: { id: true, orderId: true, sku: true },
      orderBy: [{ orderId: "asc" }, { sku: "asc" }, { id: "asc" }],
    });
    const packageByOrder = new Map<string, number>();
    await tx.pickupBatchLine.createMany({
      data: items.map((item) => {
        const packageNo = (packageByOrder.get(item.orderId) ?? 0) + 1;
        packageByOrder.set(item.orderId, packageNo);
        return {
          batchId,
          orderId: item.orderId,
          orderItemId: item.id,
          packageNo,
        };
      }),
    });
    await tx.order.updateMany({
      where: { id: { in: orderIds }, status: "KREIRANO" },
      data: { status: "U_PRIPREMI" },
    });
    await tx.orderStatusEvent.createMany({
      data: orderIds.map((orderId) => ({
        orderId,
        status: "U_PRIPREMI" as const,
        note: `Porudžbina učitana u nalog za preuzimanje ${batch.number}.`,
        actorId,
      })),
    });
    return { orderCount: orderIds.length, lineCount: items.length };
  }, TRANSACTION_OPTIONS);
}

export async function removeOrderFromPickupBatch(
  batchId: string,
  orderId: string,
  actorId: string,
) {
  return db.$transaction(async (tx) => {
    await lockBatch(tx, batchId);
    await lockOrders(tx, [orderId]);
    const batch = await tx.pickupBatch.findUnique({
      where: { id: batchId },
      select: { id: true, status: true, number: true },
    });
    assertEditableBatch(batch);
    const removed = await tx.pickupBatchLine.deleteMany({
      where: { batchId, orderId },
    });
    if (!removed.count) {
      throw new Error("Porudžbina nije pronađena u ovom nalogu.");
    }
    await restoreOrderIfNoLongerLoaded(tx, orderId, actorId, batch.number);
    return { removedLineCount: removed.count };
  }, TRANSACTION_OPTIONS);
}

export async function deletePickupBatches(
  batchIds: string[],
  actorId: string,
) {
  if (!batchIds.length) throw new Error("Izaberite bar jedan nalog.");
  return db.$transaction(async (tx) => {
    const uniqueIds = Array.from(new Set(batchIds)).sort();
    for (const batchId of uniqueIds) await lockBatch(tx, batchId);
    const batches = await tx.pickupBatch.findMany({
      where: { id: { in: uniqueIds } },
      include: {
        lines: { select: { orderId: true } },
      },
    });
    if (batches.length !== uniqueIds.length) {
      throw new Error("Jedan od izabranih naloga više ne postoji.");
    }
    for (const batch of batches) assertEditableBatch(batch);
    const orderIds = Array.from(
      new Set(batches.flatMap((batch) => batch.lines.map((line) => line.orderId))),
    ).sort();
    await lockOrders(tx, orderIds);
    const deleted = await tx.pickupBatch.deleteMany({
      where: { id: { in: uniqueIds } },
    });
    for (const orderId of orderIds) {
      await restoreOrderIfNoLongerLoaded(
        tx,
        orderId,
        actorId,
        batches.find((batch) =>
          batch.lines.some((line) => line.orderId === orderId),
        )?.number ?? "obrisan nalog",
      );
    }
    return { deletedCount: deleted.count };
  }, TRANSACTION_OPTIONS);
}

export async function postPickupBatches(batchIds: string[], actorId: string) {
  if (!batchIds.length) throw new Error("Izaberite bar jedan nalog.");
  const availability = await getPickupPostingAvailability();
  if (!availability.available) throw new Error(availability.reason);

  const uniqueIds = Array.from(new Set(batchIds));
  let posted = 0;
  let shipmentCount = 0;
  for (const batchId of uniqueIds) {
    const result = await postPickupBatch(batchId, actorId);
    posted += 1;
    shipmentCount += result.shipmentCount;
  }
  return { posted, shipmentCount };
}

async function postPickupBatch(batchId: string, actorId: string) {
  const stalePosting = new Date(Date.now() - 30 * 60_000);
  await db.pickupBatch.updateMany({
    where: { id: batchId, status: "POSTING", updatedAt: { lt: stalePosting } },
    data: {
      status: "DRAFT",
      configurationIssue:
        "Prethodno slanje je prekinuto. Bezbedan idempotentni pokušaj je ponovljen.",
    },
  });
  const claimed = await db.pickupBatch.updateMany({
    where: { id: batchId, status: "DRAFT" },
    data: { status: "POSTING", configurationIssue: null },
  });
  if (!claimed.count) {
    throw new Error(
      "Nalog nije nov ili ga drugi administrator trenutno šalje kurirskoj službi.",
    );
  }

  try {
    const batch = await db.pickupBatch.findUnique({
      where: { id: batchId },
      include: {
        lines: {
          select: { orderId: true },
          orderBy: [{ orderId: "asc" }, { packageNo: "asc" }],
        },
      },
    });
    if (!batch || batch.status !== "POSTING") {
      throw new Error("Nalog za preuzimanje nije dostupan za knjiženje.");
    }
    if (!batch.pickupDate) {
      throw new Error("Datum preuzimanja je obavezan pre knjiženja naloga.");
    }
    const orderIds = Array.from(new Set(batch.lines.map((line) => line.orderId)));
    if (!orderIds.length) {
      throw new Error("Nalog nema nijednu porudžbinu za preuzimanje.");
    }

    const shipmentIds: string[] = [];
    for (const orderId of orderIds) {
      const shipment = await createShipmentForOrder(orderId);
      if (shipment.provider !== X_EXPRESS_PROVIDER || shipment.status === "FAILED") {
        throw new Error(
          `Porudžbina ${orderId} nije uspešno najavljena X Express-u.`,
        );
      }
      shipmentIds.push(shipment.id);
    }

    await db.$transaction(async (tx) => {
      await lockBatch(tx, batch.id);
      const completed = await tx.pickupBatch.updateMany({
        where: { id: batch.id, status: "POSTING" },
        data: {
          status: "BOOKED",
          manifestRef: `XEXPRESS:${batch.number}`,
          configurationIssue: null,
        },
      });
      if (!completed.count) {
        throw new Error("Status naloga promenjen je tokom knjiženja.");
      }
      await tx.orderStatusEvent.createMany({
        data: orderIds.map((orderId) => ({
          orderId,
          status: "U_PRIPREMI" as const,
          note: `Nalog za preuzimanje ${batch.number} proknjižen i poslat X Express-u.`,
          actorId,
        })),
      });
    }, TRANSACTION_OPTIONS);
    return { shipmentCount: shipmentIds.length, shipmentIds };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Slanje X Express-u nije uspelo.";
    await db.pickupBatch.updateMany({
      where: { id: batchId, status: "POSTING" },
      data: { status: "DRAFT", configurationIssue: message },
    });
    throw error;
  }
}

async function findDcWarehouse(tx: Transaction) {
  const defaultDc = await tx.warehouse.findFirst({
    where: { active: true, isDefault: true },
    orderBy: { createdAt: "asc" },
    select: { id: true, code: true, name: true },
  });
  if (defaultDc) return defaultDc;
  return tx.warehouse.findFirst({
    where: { active: true, code: { equals: "DC", mode: "insensitive" } },
    orderBy: { createdAt: "asc" },
    select: { id: true, code: true, name: true },
  });
}

async function restoreOrderIfNoLongerLoaded(
  tx: Transaction,
  orderId: string,
  actorId: string,
  batchNumber: string,
) {
  const remaining = await tx.pickupBatchLine.count({ where: { orderId } });
  if (remaining) return false;
  const updated = await tx.order.updateMany({
    where: { id: orderId, status: "U_PRIPREMI" },
    data: { status: "KREIRANO" },
  });
  if (!updated.count) return false;
  await tx.orderStatusEvent.create({
    data: {
      orderId,
      status: "KREIRANO",
      note: `Porudžbina uklonjena iz naloga za preuzimanje ${batchNumber}.`,
      actorId,
    },
  });
  return true;
}

async function lockBatch(tx: Transaction, batchId: string) {
  await tx.$queryRaw(Prisma.sql`
    SELECT "id"
    FROM "PickupBatch"
    WHERE "id" = ${batchId}
    FOR UPDATE
  `);
}

async function lockOrders(tx: Transaction, orderIds: string[]) {
  if (!orderIds.length) return;
  await tx.$queryRaw(Prisma.sql`
    SELECT "id"
    FROM "Order"
    WHERE "id" IN (${Prisma.join(orderIds)})
    ORDER BY "id" ASC
    FOR UPDATE
  `);
}

function assertEditableBatch(
  batch: { id: string; status: PickupBatchStatus } | null,
): asserts batch is { id: string; status: PickupBatchStatus } {
  if (!batch) throw new Error("Nalog za preuzimanje ne postoji.");
  if (!isPickupBatchEditable(batch.status)) {
    throw new Error("Samo novi nalog može da se menja ili obriše.");
  }
}

function isRetryableCreateError(error: unknown) {
  return (
    (error instanceof Prisma.PrismaClientKnownRequestError &&
      (error.code === "P2002" || error.code === "P2034")) ||
    (error instanceof Error && /serialize|deadlock/i.test(error.message))
  );
}
