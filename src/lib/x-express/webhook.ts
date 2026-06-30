import "server-only";

import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { applyShipmentEvent } from "@/lib/courier/registry";
import { X_EXPRESS_PROVIDER, getXExpressConfig } from "./config";
import { inferXExpressShipmentStatus } from "./status";

const notifySchema = z.object({
  ContractId: z.string().trim().min(1),
  NotifyId: z.string().uuid(),
  OrderCode: z.string().trim().min(1).optional().nullable(),
  ReferenceId: z.string().trim().min(1),
  ReferenceGuid: z.string().uuid().optional().nullable(),
  Status: z.string().trim().min(1),
  StatusTime: z.string().datetime({ offset: true }),
});

const notifyBatchSchema = z.array(notifySchema).min(1).max(500);

export type XExpressWebhookNotify = z.infer<typeof notifySchema>;

export function verifyXExpressWebhookHeaders(headers: Headers) {
  const cfg = getXExpressConfig();
  if (!cfg.webhookApiKey) return false;
  return (
    headers.get("x-api-key") === cfg.webhookApiKey &&
    headers.get("x-api-sender") === "XExpress"
  );
}

export function parseXExpressWebhookBatch(value: unknown) {
  return notifyBatchSchema.parse(value);
}

export async function stageXExpressWebhookBatch(batch: XExpressWebhookNotify[]) {
  await db.xExpressWebhookEvent.createMany({
    data: batch.map((item) => ({
      notifyId: item.NotifyId,
      contractId: item.ContractId,
      orderCode: item.OrderCode ?? null,
      referenceId: item.ReferenceId,
      referenceGuid: item.ReferenceGuid ?? null,
      statusCode: item.Status,
      statusTime: new Date(item.StatusTime),
      raw: item as Prisma.InputJsonValue,
    })),
    skipDuplicates: true,
  });
}

export async function processXExpressWebhookEvents(limit = 100) {
  const events = await db.xExpressWebhookEvent.findMany({
    where: { processedAt: null },
    orderBy: [{ statusTime: "asc" }, { createdAt: "asc" }],
    take: Math.max(1, Math.min(limit, 500)),
  });

  let processed = 0;
  let failed = 0;

  for (const event of events) {
    try {
      await processXExpressWebhookEvent(event);
      processed += 1;
    } catch (err) {
      failed += 1;
      await db.xExpressWebhookEvent.update({
        where: { id: event.id },
        data: {
          processError:
            err instanceof Error ? err.message : "X Express webhook obrada nije uspela.",
        },
      });
    }
  }

  return { read: events.length, processed, failed };
}

async function processXExpressWebhookEvent(event: {
  id: string;
  notifyId: string;
  orderCode: string | null;
  referenceId: string;
  referenceGuid: string | null;
  statusCode: string;
  statusTime: Date;
  raw: Prisma.JsonValue;
}) {
  const order = await db.order.findFirst({
    where: {
      OR: [{ number: event.referenceId }, { id: event.referenceId }],
    },
    select: {
      id: true,
      shipments: {
        where: { provider: X_EXPRESS_PROVIDER },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { id: true, trackingNo: true },
      },
    },
  });
  if (!order) {
    throw new Error(`Porudžbina za ReferenceId ${event.referenceId} nije pronađena.`);
  }
  const shipment = order.shipments[0];
  if (!shipment?.trackingNo) {
    throw new Error(`X Express pošiljka za ReferenceId ${event.referenceId} nije pronađena.`);
  }

  await db.shipment.update({
    where: { id: shipment.id },
    data: {
      providerOrderId: event.orderCode ?? undefined,
      providerShipmentId: event.referenceGuid ?? undefined,
      providerStatusCode: event.statusCode,
      syncError: null,
    },
  });

  const result = await applyShipmentEvent("COURIER_SMALL", {
    trackingNo: shipment.trackingNo,
    status: inferXExpressShipmentStatus(event.statusCode, null),
    providerStatusCode: event.statusCode,
    providerEventId: event.notifyId,
    occurredAt: event.statusTime,
    raw: event.raw,
  });
  if (!result) {
    throw new Error(`Pošiljka ${shipment.trackingNo} nije pronađena za X Express webhook.`);
  }

  await db.xExpressWebhookEvent.update({
    where: { id: event.id },
    data: {
      orderId: order.id,
      shipmentId: shipment.id,
      processedAt: new Date(),
      processError: null,
    },
  });
}
