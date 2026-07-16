import "server-only";

import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  applyShipmentEvent,
  type ApplyEventResult,
} from "@/lib/courier/registry";
import { loadOrderForEmail, sendOrderStatusChanged } from "@/lib/email";
import { enqueueBackgroundJob } from "@/lib/background-jobs";
import { X_EXPRESS_PROVIDER, getXExpressConfig } from "./config";
import { inferXExpressShipmentStatus } from "./status";

// z.preprocess() in Zod v4 doesn't inherit .optional()/.nullable() from the
// inner schema for a missing object key — it must be applied to the
// preprocess result itself, or a payload omitting the key fails validation.
const optionalText = z
  .preprocess(
    (value) => (typeof value === "string" && !value.trim() ? null : value),
    z.string().trim().min(1),
  )
  .optional()
  .nullable();

const optionalUuid = z
  .preprocess(
    (value) => (typeof value === "string" && !value.trim() ? null : value),
    z.string().uuid(),
  )
  .optional()
  .nullable();

const notifySchema = z.object({
  ContractId: z.string().trim().min(1),
  NotifyId: z.string().uuid(),
  OrderCode: optionalText,
  ReferenceId: z.string().trim().min(1),
  ReferenceGuid: optionalUuid,
  Status: z.string().trim().min(1),
  StatusTime: z
    .string()
    .trim()
    .min(1)
    .refine((value) => !Number.isNaN(new Date(value).getTime())),
});

const notifyBatchSchema = z.array(notifySchema).min(1).max(500);

export type XExpressWebhookNotify = z.infer<typeof notifySchema>;

export function verifyXExpressWebhookHeaders(headers: Headers) {
  const cfg = getXExpressConfig();
  if (!cfg.webhookApiKey) return false;
  const bearer = headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  return (
    (headers.get("x-api-key") === cfg.webhookApiKey ||
      bearer === cfg.webhookApiKey) &&
    headers.get("x-api-sender") === "XExpress"
  );
}

export function parseXExpressWebhookBatch(value: unknown) {
  const payload = unwrapWebhookPayload(value);
  return notifyBatchSchema.parse(Array.isArray(payload) ? payload : [payload]);
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
      statusTime: parseStatusTime(item.StatusTime),
      raw: item as Prisma.InputJsonValue,
    })),
    skipDuplicates: true,
  });
}

function unwrapWebhookPayload(value: unknown) {
  if (isRecord(value)) {
    for (const key of ["notifications", "events", "items", "data", "result"]) {
      const nested = value[key];
      if (nested != null) return nested;
    }
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseStatusTime(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`X Express StatusTime nije validan: ${value}`);
  }
  return parsed;
}

export async function processXExpressWebhookEvents(limit = 100) {
  const events = await db.xExpressWebhookEvent.findMany({
    where: { processedAt: null },
    orderBy: [{ statusTime: "asc" }, { createdAt: "asc" }],
    take: Math.max(1, Math.min(limit, 500)),
  });

  return processXExpressWebhookRows(events);
}

export async function processXExpressWebhookNotifyIds(notifyIds: string[]) {
  const ids = [...new Set(notifyIds.filter(Boolean))];
  if (!ids.length) {
    return { read: 0, processed: 0, failed: 0 };
  }

  const events = await db.xExpressWebhookEvent.findMany({
    where: {
      notifyId: { in: ids },
      processedAt: null,
    },
    orderBy: [{ statusTime: "asc" }, { createdAt: "asc" }],
  });

  return processXExpressWebhookRows(events);
}

async function processXExpressWebhookRows(events: XExpressWebhookEventRow[]) {
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

type XExpressWebhookEventRow = {
  id: string;
  notifyId: string;
  orderCode: string | null;
  referenceId: string;
  referenceGuid: string | null;
  statusCode: string;
  statusTime: Date;
  raw: Prisma.JsonValue;
};

async function processXExpressWebhookEvent(event: XExpressWebhookEventRow) {
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
  if (result.eventCreated) {
    await notifyShipmentSideEffects(result);
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

async function notifyShipmentSideEffects(result: ApplyEventResult) {
  if (result.customerEmail) {
    try {
      const loaded = await loadOrderForEmail(result.orderId);
      if (loaded?.recipient) {
        await sendOrderStatusChanged({
          order: loaded.order,
          status: loaded.order.status,
          to: loaded.recipient,
        });
      }
    } catch (err) {
      console.error("[email] order-status (x-express webhook) failed", err);
    }
  }

  if (result.status === "PICKED_UP") {
    await enqueueBackgroundJob({
      kind: "FISCAL_RECEIPT",
      payload: { orderId: result.orderId },
      idempotencyKey: `fiscal-pickup:${result.orderId}`,
    });
  }
}
