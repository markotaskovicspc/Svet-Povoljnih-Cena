import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { envValue } from "@/lib/env";
import {
  CourierConfigError,
  CourierProviderError,
  type CourierAdapter,
  type CourierOrderInput,
  type CourierShipmentResult,
  type CourierWebhookEvent,
} from "./types";
import { mapBulkyStatus } from "./status";

/**
 * Phase 4C — Bulky / kamionska adapter.
 *
 * Internally this routes to the in-house dispatcher (sub-contracted truck
 * drivers covering Belgrade + Novi Sad + Niš). The dispatcher exposes a
 * minimal REST API:
 *
 *   POST {BULKY_API_BASE}/dispatch/orders   → returns { waybill, labelPdfUrl }
 *   POST {BULKY_API_BASE}/dispatch/webhook  ← status updates
 *
 * Webhook auth uses an HMAC-SHA256 signature in `X-Spc-Dispatch-Signature`.
 * Dry-run fallback (no env) is identical to small parcel — useful for
 * dev/staging without exposing the dispatcher to test traffic.
 */

interface BulkyConfig {
  apiBase: string;
  apiKey: string;
  webhookSecret: string;
  fleetId: string;
}

class DryRunMarker extends Error {}

function readConfig(): BulkyConfig | DryRunMarker {
  const apiBase = envValue("BULKY_API_BASE");
  const apiKey = envValue("BULKY_API_KEY");
  const webhookSecret = envValue("BULKY_WEBHOOK_SECRET");
  const fleetId = envValue("BULKY_FLEET_ID");
  if (!apiBase || !apiKey || !webhookSecret || !fleetId) {
    return new DryRunMarker(
      "Bulky dispatcher not configured — using dry-run waybills.",
    );
  }
  return { apiBase: apiBase.replace(/\/$/, ""), apiKey, webhookSecret, fleetId };
}

async function createWaybill(
  input: CourierOrderInput,
): Promise<CourierShipmentResult> {
  const cfg = readConfig();
  if (cfg instanceof DryRunMarker) {
    throw new CourierConfigError(cfg.message);
  }

  const body = {
    fleetId: cfg.fleetId,
    reference: input.orderNumber,
    cod: input.cashOnDelivery ? input.total : 0,
    recipient: {
      name: `${input.recipient.firstName} ${input.recipient.lastName}`.trim(),
      company: input.recipient.companyName ?? null,
      phone: input.recipient.phone,
      address: input.recipient.street,
      city: input.recipient.city,
      postalCode: input.recipient.postalCode,
      country: input.recipient.country,
    },
    items: input.packageCount ?? 1,
    weightKg: input.weightKg ?? 60,
    notes: input.notes ?? null,
  };

  const res = await fetch(`${cfg.apiBase}/dispatch/orders`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${cfg.apiKey}`,
      "content-type": "application/json",
      "idempotency-key": input.orderNumber,
    },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as {
    waybill?: string;
    labelPdfUrl?: string;
    error?: string;
    code?: string;
  };
  if (!res.ok || !json.waybill || !json.labelPdfUrl) {
    throw new CourierProviderError(
      json.error ??
        `Kamionski dispečer odbio kreiranje pošiljke (HTTP ${res.status}).`,
      json.code,
    );
  }
  return { trackingNo: json.waybill, labelUrl: json.labelPdfUrl, raw: json };
}

function verifyWebhookSignature(req: {
  headers: Headers;
  rawBody: string;
}): boolean {
  const cfg = readConfig();
  if (cfg instanceof DryRunMarker) {
    throw new CourierConfigError(cfg.message);
  }
  const header = req.headers.get("x-spc-dispatch-signature");
  if (!header) return false;
  const expected = createHmac("sha256", cfg.webhookSecret)
    .update(req.rawBody, "utf8")
    .digest("hex");
  const a = Buffer.from(header, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function parseWebhookEvent(rawBody: string): CourierWebhookEvent {
  const json = JSON.parse(rawBody) as {
    waybill?: string;
    status?: string;
    message?: string;
    occurredAt?: string;
  };
  if (!json.waybill || !json.status) {
    throw new CourierProviderError("Nevažeći payload kamionskog dispečera.");
  }
  const status = mapBulkyStatus(json.status);
  if (!status) {
    throw new CourierProviderError(`Nepoznat status: ${json.status}`);
  }
  return {
    trackingNo: json.waybill,
    status,
    message: json.message,
    occurredAt: json.occurredAt ? new Date(json.occurredAt) : undefined,
    raw: json,
  };
}

export const bulkyAdapter: CourierAdapter = {
  service: "COURIER_BULKY",
  label: "Kamionska isporuka",
  createWaybill,
  verifyWebhookSignature,
  parseWebhookEvent,
};
