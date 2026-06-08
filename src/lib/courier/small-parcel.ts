import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import {
  CourierConfigError,
  CourierProviderError,
  type CourierAdapter,
  type CourierOrderInput,
  type CourierShipmentResult,
  type CourierWebhookEvent,
} from "./types";
import { mapXExpressStatus } from "./status";

/**
 * Small parcel adapter: X Express.
 *
 * Creation is handled by `createShipmentForOrder`, because X Express needs
 * order/payment context and a transactionally allocated tracking code range.
 * The adapter remains registered for the generic webhook route and dev dry-run
 * compatibility.
 */

async function createWaybill(
  input: CourierOrderInput,
): Promise<CourierShipmentResult> {
  if (process.env.X_EXPRESS_ENABLED === "true") {
    throw new CourierConfigError(
      "X Express nalog se kreira kroz createShipmentForOrder zbog opsega kodova.",
    );
  }
  const trackingNo = `XEX-${input.orderNumber}`;
  return {
    trackingNo,
    labelUrl: `data:text/plain;base64,${Buffer.from(
      `Dry-run X Express nalog za ${input.orderNumber}`,
    ).toString("base64")}`,
    raw: { dryRun: true },
  };
}

function verifyWebhookSignature(req: {
  headers: Headers;
  rawBody: string;
}): boolean {
  const secret = process.env.X_EXPRESS_WEBHOOK_SECRET;
  if (!secret) {
    throw new CourierConfigError("X Express webhook secret nije podešen.");
  }
  const header = req.headers.get("x-express-signature");
  if (!header) return false;
  const expected = createHmac("sha256", secret).update(req.rawBody, "utf8").digest("hex");
  const a = Buffer.from(header, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function parseWebhookEvent(rawBody: string): CourierWebhookEvent {
  const json = JSON.parse(rawBody) as {
    trackingNo?: string;
    trackingNumber?: string;
    shipmentCode?: string;
    status?: string;
    statusCode?: string;
    message?: string;
    occurredAt?: string;
    eventId?: string;
  };
  const trackingNo = json.trackingNo ?? json.trackingNumber ?? json.shipmentCode;
  const providerStatusCode = json.statusCode ?? json.status;
  if (!trackingNo || !providerStatusCode) {
    throw new CourierProviderError("Nevažeći X Express webhook payload.");
  }
  const status = mapXExpressStatus(providerStatusCode);
  if (!status) {
    throw new CourierProviderError(`Nepoznat X Express status: ${providerStatusCode}`);
  }
  return {
    trackingNo,
    status,
    providerStatusCode,
    providerEventId: json.eventId,
    message: json.message,
    occurredAt: json.occurredAt ? new Date(json.occurredAt) : undefined,
    raw: json,
  };
}

export const smallParcelAdapter: CourierAdapter = {
  service: "COURIER_SMALL",
  label: "X Express",
  createWaybill,
  verifyWebhookSignature,
  parseWebhookEvent,
};
