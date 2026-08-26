import "server-only";

import { timingSafeEqual } from "node:crypto";
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { syncProductChannelAvailability } from "@/lib/channel-availability.server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const CONFIRMATION = "RESTORE_ORDER_CLEANUP_2026_08_26";
const BACKUP_ACTION = "maintenance.order-cleanup.backup";
const PRESERVED_ORDER_NUMBER = "VP-2026-00012";
const CANCELLED_MYGLS_ORDER_NUMBERS = new Set([
  "SPC-2026-000036",
  "SPC-2026-000039",
  "SPC-2026-000042",
  "SPC-2026-000043",
]);

type JsonRecord = Record<string, unknown>;
type RestoreTable =
  | "PickupBatch"
  | "Order"
  | "OrderItem"
  | "OrderStatusEvent"
  | "Payment"
  | "Invoice"
  | "FiscalReceipt"
  | "FiscalDocument"
  | "FiscalDocumentLine"
  | "PaymentRefund"
  | "Reclamation"
  | "ReclamationPhoto"
  | "ReclamationStatusEvent"
  | "Shipment"
  | "ShipmentEvent"
  | "SupplierFulfillment"
  | "SupplierFulfillmentItem"
  | "VoucherRedemption"
  | "PickupBatchLine";

function authorized(request: Request) {
  const expected = process.env.ADMIN_API_SECRET?.trim();
  const supplied = request.headers
    .get("authorization")
    ?.replace(/^Bearer\s+/i, "")
    .trim();
  if (!expected || !supplied) return false;
  const expectedBytes = Buffer.from(expected);
  const suppliedBytes = Buffer.from(supplied);
  return (
    expectedBytes.length === suppliedBytes.length &&
    timingSafeEqual(expectedBytes, suppliedBytes)
  );
}

function record(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function records(value: unknown): JsonRecord[] {
  return Array.isArray(value)
    ? value.map(record).filter((value): value is JsonRecord => Boolean(value))
    : [];
}

function stringValue(value: unknown) {
  return typeof value === "string" && value ? value : null;
}

function uniqueRecords(values: JsonRecord[]) {
  const byId = new Map<string, JsonRecord>();
  for (const value of values) {
    const id = stringValue(value.id);
    if (id) byId.set(id, value);
  }
  return [...byId.values()];
}

async function insertRecord(
  tx: Prisma.TransactionClient,
  table: RestoreTable,
  value: JsonRecord,
) {
  await tx.$executeRawUnsafe(
    `INSERT INTO "${table}" SELECT * FROM jsonb_populate_record(NULL::"${table}", $1::jsonb) ON CONFLICT DO NOTHING`,
    JSON.stringify(value),
  );
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as {
    confirmation?: unknown;
  } | null;
  if (body?.confirmation !== CONFIRMATION) {
    return NextResponse.json(
      { error: "Invalid confirmation." },
      { status: 400 },
    );
  }

  const backupLogs = await db.auditLog.findMany({
    where: { action: BACKUP_ACTION },
    orderBy: { createdAt: "asc" },
    select: { id: true, diff: true },
  });
  const orders = backupLogs
    .map((log) => record(record(log.diff)?.order))
    .filter((value): value is JsonRecord => Boolean(value));
  const orderNumbers = orders
    .map((order) => stringValue(order.number))
    .filter((value): value is string => Boolean(value));
  if (
    orders.length !== 46 ||
    new Set(orderNumbers).size !== 46 ||
    orderNumbers.includes(PRESERVED_ORDER_NUMBER)
  ) {
    return NextResponse.json(
      { error: "Production backup set failed validation." },
      { status: 409 },
    );
  }

  const existing = await db.order.findMany({
    where: { number: { in: orderNumbers } },
    select: { number: true },
  });
  if (existing.length) {
    return NextResponse.json(
      {
        error: "Recovery target is not empty.",
        existingOrderNumbers: existing.map((order) => order.number),
      },
      { status: 409 },
    );
  }

  const result = await db.$transaction(
    async (tx) => {
      const pickupBatches = uniqueRecords(
        orders.flatMap((order) =>
          records(order.pickupBatchLines)
            .map((line) => record(line.batch))
            .filter((value): value is JsonRecord => Boolean(value)),
        ),
      );
      for (const batch of pickupBatches) {
        await insertRecord(tx, "PickupBatch", batch);
      }

      for (const order of orders) await insertRecord(tx, "Order", order);

      const orderItems = uniqueRecords(
        orders.flatMap((order) => records(order.items)),
      );
      for (const item of orderItems) await insertRecord(tx, "OrderItem", item);

      const orderEvents = uniqueRecords(
        orders.flatMap((order) => records(order.events)),
      );
      for (const event of orderEvents)
        await insertRecord(tx, "OrderStatusEvent", event);

      const payments = uniqueRecords(
        orders.flatMap((order) => records(order.payments)),
      );
      for (const payment of payments)
        await insertRecord(tx, "Payment", payment);

      const invoices = uniqueRecords(
        orders.flatMap((order) => records(order.invoices)),
      );
      for (const invoice of invoices)
        await insertRecord(tx, "Invoice", invoice);

      const fiscalReceipts = uniqueRecords(
        orders
          .map((order) => record(order.fiscal))
          .filter((value): value is JsonRecord => Boolean(value)),
      );
      for (const receipt of fiscalReceipts) {
        await insertRecord(tx, "FiscalReceipt", receipt);
      }

      const fiscalDocuments = uniqueRecords(
        orders.flatMap((order) => records(order.fiscalDocuments)),
      );
      for (const document of fiscalDocuments) {
        await insertRecord(tx, "FiscalDocument", document);
      }
      const fiscalLines = uniqueRecords(
        fiscalDocuments.flatMap((document) => records(document.lines)),
      );
      for (const line of fiscalLines) {
        await insertRecord(tx, "FiscalDocumentLine", {
          ...line,
          originalSaleLineId: null,
        });
      }
      for (const line of fiscalLines) {
        const id = stringValue(line.id);
        const originalSaleLineId = stringValue(line.originalSaleLineId);
        if (id && originalSaleLineId) {
          await tx.fiscalDocumentLine.update({
            where: { id },
            data: { originalSaleLineId },
          });
        }
      }

      const paymentRefunds = uniqueRecords([
        ...orders.flatMap((order) => records(order.paymentRefunds)),
        ...fiscalDocuments.flatMap((document) =>
          records(document.paymentRefunds),
        ),
      ]);
      for (const refund of paymentRefunds) {
        await insertRecord(tx, "PaymentRefund", refund);
      }

      const reclamations = uniqueRecords(
        orders.flatMap((order) => records(order.reclamations)),
      );
      for (const reclamation of reclamations) {
        await insertRecord(tx, "Reclamation", reclamation);
      }
      const reclamationPhotos = uniqueRecords(
        reclamations.flatMap((reclamation) => records(reclamation.photos)),
      );
      for (const photo of reclamationPhotos) {
        await insertRecord(tx, "ReclamationPhoto", photo);
      }
      const reclamationEvents = uniqueRecords(
        reclamations.flatMap((reclamation) => records(reclamation.events)),
      );
      for (const event of reclamationEvents) {
        await insertRecord(tx, "ReclamationStatusEvent", event);
      }

      const shipments = uniqueRecords([
        ...orders.flatMap((order) => records(order.shipments)),
        ...reclamations.flatMap((reclamation) =>
          records(reclamation.shipments),
        ),
      ]);
      for (const shipment of shipments) {
        const orderNumber = orders.find(
          (order) => order.id === shipment.orderId,
        )?.number;
        const restored =
          shipment.provider === "MYGLS" &&
          typeof orderNumber === "string" &&
          CANCELLED_MYGLS_ORDER_NUMBERS.has(orderNumber)
            ? {
                ...shipment,
                status: "FAILED",
                syncError:
                  "MyGLS etiketa je otkazana tokom pogrešnog cleanup-a; kreirati novu etiketu.",
                labelObjectKey: null,
                labelUrl: null,
              }
            : shipment;
        await insertRecord(tx, "Shipment", restored);
      }
      const shipmentEvents = uniqueRecords(
        shipments.flatMap((shipment) => records(shipment.events)),
      );
      for (const event of shipmentEvents) {
        await insertRecord(tx, "ShipmentEvent", event);
      }

      const fulfillments = uniqueRecords(
        orders.flatMap((order) => records(order.supplierFulfillments)),
      );
      for (const fulfillment of fulfillments) {
        await insertRecord(tx, "SupplierFulfillment", fulfillment);
      }
      const fulfillmentItems = uniqueRecords(
        fulfillments.flatMap((fulfillment) => records(fulfillment.items)),
      );
      for (const item of fulfillmentItems) {
        await insertRecord(tx, "SupplierFulfillmentItem", item);
      }

      const voucherRedemptions = uniqueRecords(
        orders
          .map((order) => record(order.voucherRedemption))
          .filter((value): value is JsonRecord => Boolean(value)),
      );
      for (const redemption of voucherRedemptions) {
        await insertRecord(tx, "VoucherRedemption", redemption);
      }

      const pickupLines = uniqueRecords([
        ...orders.flatMap((order) => records(order.pickupBatchLines)),
        ...reclamations.flatMap((reclamation) =>
          records(reclamation.pickupBatchLines),
        ),
      ]);
      for (const line of pickupLines) {
        await insertRecord(tx, "PickupBatchLine", line);
      }

      const checkoutSessions = uniqueRecords(
        orders.flatMap((order) => records(order.checkoutSessions)),
      );
      for (const session of checkoutSessions) {
        const id = stringValue(session.id);
        const orderId = stringValue(session.orderId);
        if (id && orderId) {
          await tx.checkoutSession.updateMany({
            where: { id },
            data: { orderId },
          });
        }
      }

      const analyticsEvents = uniqueRecords(
        orders.flatMap((order) => records(order.analyticsEvents)),
      );
      for (const event of analyticsEvents) {
        const id = stringValue(event.id);
        const orderId = stringValue(event.orderId);
        if (id && orderId) {
          await tx.analyticsEvent.updateMany({
            where: { id },
            data: { orderId },
          });
        }
      }

      const stockMovements = uniqueRecords(
        orders.flatMap((order) => records(order.stockMovements)),
      );
      for (const movement of stockMovements) {
        const id = stringValue(movement.id);
        if (!id) continue;
        await tx.stockMovement.updateMany({
          where: { id },
          data: {
            orderId: stringValue(movement.orderId),
            orderItemId: stringValue(movement.orderItemId),
            fiscalDocumentId: stringValue(movement.fiscalDocumentId),
          },
        });
      }

      const cleanupKeys = orders.flatMap((order) => {
        const orderId = stringValue(order.id);
        if (!orderId) return [];
        return records(order.items)
          .map((item) => stringValue(item.id))
          .filter((itemId): itemId is string => Boolean(itemId))
          .map(
            (itemId) => `order:${orderId}:maintenance-test-cleanup:${itemId}`,
          );
      });
      const cleanupAdjustments = await tx.stockMovement.findMany({
        where: { idempotencyKey: { in: cleanupKeys } },
      });
      for (const adjustment of cleanupAdjustments) {
        if (adjustment.productId && adjustment.qty > 0) {
          await tx.warehouseStock.update({
            where: {
              warehouseId_productId: {
                warehouseId: adjustment.warehouseId,
                productId: adjustment.productId,
              },
            },
            data: { qty: { decrement: adjustment.qty } },
          });
          await tx.product.update({
            where: { id: adjustment.productId },
            data: { stock: { decrement: adjustment.qty } },
          });
        }
        await tx.stockMovement.delete({ where: { id: adjustment.id } });
      }

      for (const fulfillment of fulfillments) {
        if (fulfillment.reservationReleasedAt) continue;
        for (const item of records(fulfillment.items)) {
          const productId = stringValue(item.productId);
          const qty = typeof item.qty === "number" ? item.qty : 0;
          if (productId && qty > 0) {
            await tx.product.update({
              where: { id: productId },
              data: { supplierReservedStock: { increment: qty } },
            });
          }
        }
      }

      const productIds = new Set<string>();
      for (const item of orderItems) {
        const productId = stringValue(item.productId);
        if (productId) productIds.add(productId);
      }
      for (const productId of productIds) {
        await syncProductChannelAvailability(tx, productId);
      }

      await tx.auditLog.create({
        data: {
          action: "maintenance.order-cleanup.recovered",
          entity: "OrderRecovery",
          diff: {
            restoredOrderNumbers: orderNumbers,
            restoredCount: orders.length,
            restoredAt: new Date().toISOString(),
            myGlsLabelsRequiringRecreation: [...CANCELLED_MYGLS_ORDER_NUMBERS],
          },
        },
      });

      return {
        restoredCount: orders.length,
        itemCount: orderItems.length,
        paymentCount: payments.length,
        invoiceCount: invoices.length,
        fiscalDocumentCount: fiscalDocuments.length,
        shipmentCount: shipments.length,
        pickupBatchCount: pickupBatches.length,
        cleanupAdjustmentCount: cleanupAdjustments.length,
      };
    },
    { maxWait: 15_000, timeout: 240_000, isolationLevel: "Serializable" },
  );

  return NextResponse.json(
    {
      ok: true,
      ...result,
      preservedOrderNumber: PRESERVED_ORDER_NUMBER,
      totalExpectedOrders: result.restoredCount + 1,
      myGlsLabelsRequiringRecreation: [...CANCELLED_MYGLS_ORDER_NUMBERS],
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
