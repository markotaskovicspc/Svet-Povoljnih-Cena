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
  XExpressAddressCheckPayload,
  XExpressAddressCheckResponse,
  XExpressLocationCode,
  XExpressMunicipality,
  XExpressStatusCode,
  XExpressStreet,
  XExpressTown,
  XExpressTrackingEvent,
} from "./types";

type Method = "GET" | "POST";

export class XExpressClient {
  constructor(
    private readonly cfg: XExpressConfig = requireXExpressEnabled(),
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async fetchLocationCodes(): Promise<XExpressLocationCode[]> {
    return this.fetchTowns().then((towns) =>
      towns.map((town) => ({
        code: String(town.id),
        name: town.displayName ?? town.name,
        postalCode: town.postalCode ?? null,
        municipality: town.municipalityId ? String(town.municipalityId) : null,
        city: town.name,
        settlement: town.name,
        raw: town.raw,
      })),
    );
  }

  async fetchMunicipalities(): Promise<XExpressMunicipality[]> {
    const path = requireXExpressPath(this.cfg, "municipalities");
    const raw = await this.request("GET", path);
    return unwrapList(raw, ["municipalities", "items", "data"]).map(parseMunicipality);
  }

  async fetchTowns(): Promise<XExpressTown[]> {
    const path = requireXExpressPath(this.cfg, "towns");
    const raw = await this.request("GET", path);
    return unwrapList(raw, ["towns", "items", "data"]).map(parseTown);
  }

  async fetchStreets(): Promise<XExpressStreet[]> {
    const path = requireXExpressPath(this.cfg, "streets");
    const raw = await this.request("GET", path);
    return unwrapList(raw, ["streets", "items", "data"]).map(parseStreet);
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

  async checkAddress(
    payload: XExpressAddressCheckPayload,
  ): Promise<XExpressAddressCheckResponse> {
    const path = requireXExpressPath(this.cfg, "checkAddress");
    const raw = await this.request("POST", path, payload);
    const record = unwrapRecord(raw);
    const valid = pickBoolean(record, ["valid", "isValid", "success", "addressValid"]);
    if (valid == null) {
      throw new XExpressProviderError(
        "X Express provera adrese nije vratila prepoznatljiv rezultat.",
        pickString(record, ["code", "errorCode"]) ?? undefined,
        redactXExpressSecrets(raw),
      );
    }
    return {
      valid,
      message: pickString(record, ["message", "description", "reason", "error"]),
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

function pickNumber(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isInteger(parsed)) return parsed;
    }
  }
  return null;
}

function pickBoolean(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "boolean") return value;
    if (typeof value === "string" && value.trim()) {
      const normalized = value.trim().toLowerCase();
      if (["true", "1", "yes"].includes(normalized)) return true;
      if (["false", "0", "no"].includes(normalized)) return false;
    }
  }
  return null;
}

export function parseXExpressMunicipality(value: unknown): XExpressMunicipality {
  return parseMunicipality(value);
}

export function parseXExpressTown(value: unknown): XExpressTown {
  return parseTown(value);
}

export function parseXExpressStreet(value: unknown): XExpressStreet {
  return parseStreet(value);
}

export function parseXExpressStatus(value: unknown): XExpressStatusCode {
  return parseStatus(value);
}

function parseMunicipality(value: unknown): XExpressMunicipality {
  const record = unwrapRecord(value);
  const id = pickNumber(record, ["id", "ID"]);
  const name = pickString(record, ["name", "Name"]);
  if (id == null || !name) {
    throw new XExpressProviderError(
      "X Express šifarnik opština nema id/name.",
      undefined,
      value,
    );
  }
  return {
    id,
    name,
    postalCode: pickString(record, ["postalCode", "PostalCode"]),
    priority: pickNumber(record, ["priority", "Priority"]),
    raw: value,
  };
}

function parseTown(value: unknown): XExpressTown {
  const record = unwrapRecord(value);
  const id = pickNumber(record, ["id", "ID"]);
  const name = pickString(record, ["name", "Name"]);
  const municipalityId = pickNumber(record, ["municipalityId", "MunicipalityId"]);
  if (id == null || !name) {
    throw new XExpressProviderError(
      "X Express šifarnik mesta nema id/name.",
      undefined,
      value,
    );
  }
  return {
    id,
    name,
    displayName: pickString(record, ["displayName", "DisplayName"]),
    municipalityId,
    postalCode: pickString(record, ["postalCode", "PostalCode"]),
    priority: pickNumber(record, ["priority", "Priority"]),
    cutOffPickupTime:
      pickString(record, [
        "cutOffPickupTime",
        "CutOffPickupTime",
        "cutoffPickupTime",
      ]) ?? null,
    raw: value,
  };
}

function parseStreet(value: unknown): XExpressStreet {
  const record = unwrapRecord(value);
  const id = pickNumber(record, ["id", "ID"]);
  const name = pickString(record, ["name", "Name"]);
  const townId = pickNumber(record, ["townId", "TownId"]);
  if (id == null || !name || townId == null) {
    throw new XExpressProviderError(
      "X Express šifarnik ulica nema id/name/townId.",
      undefined,
      value,
    );
  }
  return {
    id,
    streetId: pickNumber(record, ["streetId", "StreetId"]),
    name,
    simpleName: pickString(record, ["simpleName", "SimpleName"]),
    townId,
    official: pickBoolean(record, ["official", "Official"]) ?? false,
    deleted: pickBoolean(record, ["deleted", "Deleted"]) ?? false,
    raw: value,
  };
}

function parseStatus(value: unknown): XExpressStatusCode {
  const record = unwrapRecord(value);
  const code = pickString(record, [
    "alphaId",
    "ID",
    "id",
    "code",
    "statusCode",
    "status",
    "sifra",
  ]);
  const label = pickString(record, [
    "Name",
    "name",
    "label",
    "description",
    "message",
    "naziv",
  ]);
  if (!code || !label) {
    throw new XExpressProviderError("X Express šifarnik statusa nema code/label.", undefined, value);
  }
  const labelEn = pickString(record, ["NameEn", "nameEn", "labelEn"]);
  const shipmentStatus = inferXExpressShipmentStatus(code, label);
  return {
    code,
    label,
    labelEn,
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
