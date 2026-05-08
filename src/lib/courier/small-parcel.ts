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
import { mapSmallParcelStatus } from "./status";

/**
 * Phase 4C — Small parcel adapter (BEX Express style).
 *
 * Real provider details (URL, secret, sender pickup address) come from env:
 *
 *   BEX_API_BASE          e.g. https://api.bexexpress.rs/v2
 *   BEX_API_KEY           bearer token for outbound calls
 *   BEX_WEBHOOK_SECRET    HMAC-SHA256 secret for inbound webhooks
 *   BEX_SENDER_ID         our shipper account id at BEX
 *
 * The webhook signature header is `X-Bex-Signature: hex(sha256(rawBody))`.
 *
 * In environments where the keys are not configured the adapter still
 * works in "dry-run" mode: it returns a deterministic fake waybill so
 * dev/staging can exercise the order flow without a real BEX account.
 */

interface SmallParcelConfig {
  apiBase: string;
  apiKey: string;
  webhookSecret: string;
  senderId: string;
}

class DryRunMarker extends Error {}

function readConfig(): SmallParcelConfig | DryRunMarker {
  const apiBase = process.env.BEX_API_BASE;
  const apiKey = process.env.BEX_API_KEY;
  const webhookSecret = process.env.BEX_WEBHOOK_SECRET;
  const senderId = process.env.BEX_SENDER_ID;
  if (!apiBase || !apiKey || !webhookSecret || !senderId) {
    return new DryRunMarker("BEX not configured — using dry-run waybills.");
  }
  return { apiBase: apiBase.replace(/\/$/, ""), apiKey, webhookSecret, senderId };
}

async function createWaybill(
  input: CourierOrderInput,
): Promise<CourierShipmentResult> {
  const cfg = readConfig();
  if (cfg instanceof DryRunMarker) {
    // Deterministic dummy waybill: BEX-{orderNumber}.
    const trackingNo = `BEX-${input.orderNumber}`;
    return {
      trackingNo,
      labelUrl: `data:text/plain;base64,${Buffer.from(
        `Dry-run BEX waybill for ${input.orderNumber}`,
      ).toString("base64")}`,
      raw: { dryRun: true },
    };
  }

  const body = {
    senderId: cfg.senderId,
    reference: input.orderNumber,
    cod: input.cashOnDelivery
      ? { amount: input.total, currency: "RSD" }
      : null,
    recipient: {
      name: `${input.recipient.firstName} ${input.recipient.lastName}`.trim(),
      company: input.recipient.companyName ?? null,
      phone: input.recipient.phone,
      address: input.recipient.street,
      city: input.recipient.city,
      postalCode: input.recipient.postalCode,
      country: input.recipient.country,
    },
    parcels: input.packageCount ?? 1,
    weightKg: input.weightKg ?? 5,
    notes: input.notes ?? null,
  };

  const res = await fetch(`${cfg.apiBase}/shipments`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${cfg.apiKey}`,
      "content-type": "application/json",
      "idempotency-key": input.orderNumber,
    },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as {
    trackingNo?: string;
    labelUrl?: string;
    error?: string;
    code?: string;
  };
  if (!res.ok || !json.trackingNo || !json.labelUrl) {
    throw new CourierProviderError(
      json.error ?? `BEX odbio kreiranje pošiljke (HTTP ${res.status}).`,
      json.code,
    );
  }
  return { trackingNo: json.trackingNo, labelUrl: json.labelUrl, raw: json };
}

function verifyWebhookSignature(req: {
  headers: Headers;
  rawBody: string;
}): boolean {
  const cfg = readConfig();
  if (cfg instanceof DryRunMarker) {
    throw new CourierConfigError(cfg.message);
  }
  const header = req.headers.get("x-bex-signature");
  if (!header) return false;
  const expected = createHmac("sha256", cfg.webhookSecret)
    .update(req.rawBody, "utf8")
    .digest("hex");
  // timingSafeEqual requires equal-length buffers.
  const a = Buffer.from(header, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function parseWebhookEvent(rawBody: string): CourierWebhookEvent {
  const json = JSON.parse(rawBody) as {
    trackingNo?: string;
    status?: string;
    message?: string;
    occurredAt?: string;
  };
  if (!json.trackingNo || !json.status) {
    throw new CourierProviderError("Nevažeći BEX webhook payload.");
  }
  const status = mapSmallParcelStatus(json.status);
  if (!status) {
    throw new CourierProviderError(`Nepoznat BEX status: ${json.status}`);
  }
  return {
    trackingNo: json.trackingNo,
    status,
    message: json.message,
    occurredAt: json.occurredAt ? new Date(json.occurredAt) : undefined,
    raw: json,
  };
}

export const smallParcelAdapter: CourierAdapter = {
  service: "COURIER_SMALL",
  label: "Kurirska služba (BEX)",
  createWaybill,
  verifyWebhookSignature,
  parseWebhookEvent,
};
