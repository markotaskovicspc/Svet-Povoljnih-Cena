import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";

const migrationPath = resolve(
  process.cwd(),
  "prisma/migrations/20260903224700_backfill_pickup_courier_handover/migration.sql",
);

describe("pickup courier handover backfill", () => {
  it("backfills only matching packages, completes only proven batches, and is idempotent", async () => {
    const runId = `${Date.now()}-${process.pid}`;
    const rollback = new Error("rollback pickup courier backfill fixture");
    const shippedAt = new Date("2026-08-31T14:26:44.800Z");
    const migrationSql = await readFile(migrationPath, "utf8");
    const statements = migrationSql
      .split(/;\s*(?:\r?\n|$)/)
      .map((statement) => statement.trim())
      .filter(Boolean);
    expect(statements).toHaveLength(2);

    try {
      await db.$transaction(
        async (tx) => {
          const completeOrder = await tx.order.create({
            data: orderFixture(`QA-BACKFILL-COMPLETE-${runId}`, ["A"]),
            include: { items: true },
          });
          const partialOrder = await tx.order.create({
            data: orderFixture(`QA-BACKFILL-PARTIAL-${runId}`, ["B", "C"]),
            include: { items: { orderBy: { sku: "asc" } } },
          });

          const completeBatch = await tx.pickupBatch.create({
            data: {
              number: `PRE-QA-COMPLETE-${runId}`,
              courier: "COURIER_SMALL",
              provider: "X_EXPRESS",
              status: "BOOKED",
              lines: {
                create: {
                  orderId: completeOrder.id,
                  orderItemId: completeOrder.items[0]!.id,
                  lineGroupKey: `order:${completeOrder.id}:X_EXPRESS`,
                  packageNo: 1,
                },
              },
            },
          });
          const partialBatch = await tx.pickupBatch.create({
            data: {
              number: `PRE-QA-PARTIAL-${runId}`,
              courier: "COURIER_SMALL",
              provider: "X_EXPRESS",
              status: "BOOKED",
              lines: {
                create: partialOrder.items.map((item, index) => ({
                  orderId: partialOrder.id,
                  orderItemId: item.id,
                  lineGroupKey: `order:${partialOrder.id}:X_EXPRESS`,
                  packageNo: index + 1,
                })),
              },
            },
          });

          await tx.shipment.create({
            data: shipmentFixture({
              orderId: completeOrder.id,
              itemId: completeOrder.items[0]!.id,
              trackingNo: `QA-COMPLETE-${runId}`,
              shippedAt,
            }),
          });
          await tx.shipment.create({
            data: shipmentFixture({
              orderId: partialOrder.id,
              itemId: partialOrder.items[0]!.id,
              trackingNo: `QA-PARTIAL-MATCH-${runId}`,
              shippedAt,
            }),
          });
          await tx.shipment.create({
            data: {
              ...shipmentFixture({
                orderId: partialOrder.id,
                itemId: partialOrder.items[1]!.id,
                trackingNo: `QA-PARTIAL-WRONG-${runId}`,
                shippedAt,
              }),
              provider: "MYGLS",
            },
          });

          await runMigrationStatements(tx, statements);
          const firstResult = await readBackfillResult(tx, {
            completeBatchId: completeBatch.id,
            partialBatchId: partialBatch.id,
          });
          expect(firstResult).toEqual({
            completeStatus: "PICKED_UP",
            completePickedUpAt: [shippedAt],
            partialStatus: "BOOKED",
            partialPickedUpAt: [shippedAt, null],
          });

          await runMigrationStatements(tx, statements);
          await expect(
            readBackfillResult(tx, {
              completeBatchId: completeBatch.id,
              partialBatchId: partialBatch.id,
            }),
          ).resolves.toEqual(firstResult);
          throw rollback;
        },
        { timeout: 30_000 },
      );
    } catch (error) {
      if (error !== rollback) throw error;
    }

    await expect(
      db.order.count({ where: { number: { contains: runId } } }),
    ).resolves.toBe(0);
  });
});

function orderFixture(number: string, suffixes: string[]) {
  return {
    number,
    status: "ISPORUCENO" as const,
    channel: "WEB" as const,
    subtotal: suffixes.length * 1_000,
    total: suffixes.length * 1_000,
    shippingMethod: "KURIR" as const,
    paymentMethod: "POUZECE_GOTOVINA" as const,
    shipFirstName: "QA",
    shipLastName: "Backfill",
    shipPhone: "+38160111222",
    shipStreet: "Test statusa 13",
    shipCity: "Beograd",
    shipPostalCode: "11000",
    termsAcceptedAt: new Date("2026-08-28T21:32:05.000Z"),
    items: {
      create: suffixes.map((suffix) => ({
        sku: `${number}-${suffix}`.slice(0, 90),
        name: `Backfill artikal ${suffix}`,
        qty: 1,
        unitPriceFull: 1_000,
        unitPriceSale: 1_000,
      })),
    },
  };
}

function shipmentFixture(args: {
  orderId: string;
  itemId: string;
  trackingNo: string;
  shippedAt: Date;
}) {
  return {
    orderId: args.orderId,
    service: "COURIER_SMALL" as const,
    provider: "X_EXPRESS",
    purpose: "ORDER_DELIVERY" as const,
    status: "DELIVERED" as const,
    trackingNo: args.trackingNo,
    shippedAt: args.shippedAt,
    deliveredAt: new Date("2026-09-02T11:29:25.622Z"),
    rawCreateResponse: {
      assignment: { orderItemIds: [args.itemId], codAmount: 1_000 },
    },
  };
}

async function runMigrationStatements(
  tx: Prisma.TransactionClient,
  statements: string[],
) {
  for (const statement of statements) {
    await tx.$executeRawUnsafe(statement);
  }
}

async function readBackfillResult(
  tx: Prisma.TransactionClient,
  ids: { completeBatchId: string; partialBatchId: string },
) {
  const [complete, partial] = await Promise.all([
    tx.pickupBatch.findUniqueOrThrow({
      where: { id: ids.completeBatchId },
      select: {
        status: true,
        lines: {
          orderBy: { packageNo: "asc" },
          select: { courierPickedUpAt: true },
        },
      },
    }),
    tx.pickupBatch.findUniqueOrThrow({
      where: { id: ids.partialBatchId },
      select: {
        status: true,
        lines: {
          orderBy: { packageNo: "asc" },
          select: { courierPickedUpAt: true },
        },
      },
    }),
  ]);
  return {
    completeStatus: complete.status,
    completePickedUpAt: complete.lines.map((line) => line.courierPickedUpAt),
    partialStatus: partial.status,
    partialPickedUpAt: partial.lines.map((line) => line.courierPickedUpAt),
  };
}
