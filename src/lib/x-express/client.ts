import "server-only";

import {
  buildXExpressStatusPath,
  joinXExpressUrl,
  redactXExpressSecrets,
  requireXExpressEnabled,
  requireXExpressPath,
  type XExpressConfig,
  XExpressProviderError,
} from "./config";
import { inferXExpressShipmentStatus, orderStatusForXExpressStatus } from "./status";
import type {
  XExpressCreateOrderPayload,
  XExpressCreateOrderResponse,
  XExpressLocationCode,
  XExpressStatusCode,
  XExpressTrackingEvent,
} from "./types";

type Method = "GET" | "POST";

export class XExpressClient {
  constructor(
    private readonly cfg: XExpressConfig = requireXExpressEnabled(),
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async fetchLocationCodes(): Promise<XExpressLocationCode[]> {
    const path = requireXExpressPath(this.cfg, "locations");
    const raw = await this.request("GET", path);
    return unwrapList(raw, ["locations", "places", "items", "data"]).map(parseLocation);
  }

  async fetchStatusCodes(): Promise<XExpressStatusCode[]> {
    const path = requireXExpressPath(this.cfg, "statuses");
    const raw = await this.request("GET", path);
    return unwrapList(raw, ["statuses", "statusCodes", "items", "data"]).map(parseStatus);
  }

  async createOrder(
    payload: XExpressCreateOrderPayload,
  ): Promise<XExpressCreateOrderResponse> {
    const path = requireXExpressPath(this.cfg, "createOrder");
    const raw = await this.request("POST", path, payload);
    const record = unwrapRecord(raw);
    const trackingNo =
      pickString(record, [
        "trackingNo",
        "trackingNumber",
        "barcode",
        "code",
        "shipmentCode",
        "waybill",
        "brojPosiljke",
      ]) ?? payload.shipmentCode;
    const providerOrderId = pickString(record, [
      "orderId",
      "nalogId",
      "providerOrderId",
      "id",
    ]);
    const providerShipmentId = pickString(record, [
      "shipmentId",
      "packageId",
      "posiljkaId",
      "providerShipmentId",
    ]);
    const labelUrl = pickString(record, ["labelUrl", "labelPdfUrl", "pdfUrl", "label"]);
    const providerStatusCode = pickString(record, ["statusCode", "status", "state"]);
    return {
      trackingNo,
      labelUrl,
      providerOrderId,
      providerShipmentId,
      providerStatusCode,
      raw,
    };
  }

  async fetchTrackingEvents(trackingNo: string): Promise<XExpressTrackingEvent[]> {
    const path = buildXExpressStatusPath(
      requireXExpressPath(this.cfg, "status"),
      trackingNo,
    );
    const raw = await this.request("GET", path);
    const items = unwrapList(raw, ["events", "history", "statuses", "items", "data"]);
    const source = items.length > 0 ? items : [unwrapRecord(raw)];
    return source.map((item: unknown) => parseTrackingEvent(item, trackingNo));
  }

  private async request(
    method: Method,
    path: string,
    body?: unknown,
    attempt = 0,
  ): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    const url = joinXExpressUrl(this.cfg.baseUrl, path);

    try {
      const res = await this.fetchImpl(url, {
        method,
        cache: "no-store",
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          "x-api-user": this.cfg.apiUser,
          "x-api-key": this.cfg.apiKey,
        },
        body: body == null ? undefined : JSON.stringify(body),
      });

      const rawText = await res.text();
      const json = rawText ? safeJson(rawText) : {};
      if (!res.ok) {
        if (method === "GET" && res.status >= 500 && attempt < 2) {
          await delay(300 * (attempt + 1));
          return this.request(method, path, body, attempt + 1);
        }
        const record = isRecord(json) ? json : {};
        throw new XExpressProviderError(
          pickString(record, ["message", "error", "reason"]) ??
            `X Express zahtev nije uspeo (HTTP ${res.status}).`,
          pickString(record, ["code", "errorCode"]) ?? undefined,
          redactXExpressSecrets(json),
        );
      }
      return json;
    } catch (err) {
      if (err instanceof XExpressProviderError) throw err;
      const message =
        err instanceof Error && err.name === "AbortError"
          ? "X Express zahtev je istekao."
          : err instanceof Error
            ? err.message
            : "X Express zahtev nije uspeo.";
      throw new XExpressProviderError(message);
    } finally {
      clearTimeout(timeout);
    }
  }
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return { raw };
  }
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function unwrapRecord(value: unknown): Record<string, unknown> {
  if (isRecord(value)) {
    for (const key of ["data", "result", "item", "shipment", "order", "nalog"]) {
      const nested = value[key];
      if (isRecord(nested)) return nested;
    }
    return value;
  }
  throw new XExpressProviderError("X Express odgovor nije validan JSON objekat.", undefined, value);
}

function unwrapList(value: unknown, keys: string[]): unknown[] {
  if (Array.isArray(value)) return value;
  if (!isRecord(value)) return [];
  for (const key of keys) {
    const nested = value[key];
    if (Array.isArray(nested)) return nested;
    if (isRecord(nested)) {
      const deeper: unknown[] = unwrapList(nested, keys);
      if (deeper.length) return deeper;
    }
  }
  return [];
}

function pickString(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

function parseLocation(value: unknown): XExpressLocationCode {
  const record = unwrapRecord(value);
  const code = pickString(record, [
    "code",
    "id",
    "locationCode",
    "placeCode",
    "addressCode",
    "sifra",
  ]);
  const name = pickString(record, [
    "name",
    "label",
    "city",
    "place",
    "settlement",
    "naziv",
  ]);
  if (!code || !name) {
    throw new XExpressProviderError("X Express šifarnik adresa nema code/name.", undefined, value);
  }
  return {
    code,
    name,
    postalCode: pickString(record, ["postalCode", "zip", "postcode", "posta"]),
    municipality: pickString(record, ["municipality", "opstina"]),
    city: pickString(record, ["city", "grad"]),
    settlement: pickString(record, ["settlement", "place", "naselje"]),
    raw: value,
  };
}

function parseStatus(value: unknown): XExpressStatusCode {
  const record = unwrapRecord(value);
  const code = pickString(record, ["code", "id", "statusCode", "status", "sifra"]);
  const label = pickString(record, ["label", "name", "description", "message", "naziv"]);
  if (!code || !label) {
    throw new XExpressProviderError("X Express šifarnik statusa nema code/label.", undefined, value);
  }
  const shipmentStatus = inferXExpressShipmentStatus(code, label);
  return {
    code,
    label,
    shipmentStatus,
    orderStatus: orderStatusForXExpressStatus(shipmentStatus),
    raw: value,
  };
}

function parseTrackingEvent(value: unknown, fallbackTrackingNo: string): XExpressTrackingEvent {
  const record = unwrapRecord(value);
  const providerStatusCode =
    pickString(record, ["statusCode", "status", "code", "state", "sifra"]) ?? "";
  if (!providerStatusCode) {
    throw new XExpressProviderError("X Express status pošiljke nema status code.", undefined, value);
  }
  const message = pickString(record, ["message", "description", "label", "name", "naziv"]);
  return {
    trackingNo:
      pickString(record, ["trackingNo", "trackingNumber", "barcode", "shipmentCode"]) ??
      fallbackTrackingNo,
    providerStatusCode,
    status: inferXExpressShipmentStatus(providerStatusCode, message),
    message,
    occurredAt: parseDate(
      pickString(record, ["occurredAt", "date", "timestamp", "createdAt", "time"]),
    ),
    providerEventId: pickString(record, ["eventId", "id", "historyId"]),
    raw: value,
  };
}

function parseDate(value: string | null) {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}
