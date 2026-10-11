import "server-only";

import { requireSefConfig, type SefConfig } from "./config";

export class SefApiError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(message);
    this.name = "SefApiError";
  }
}

type FetchLike = typeof fetch;
type Delay = (milliseconds: number) => Promise<void>;

export class SefClient {
  constructor(
    private readonly config: SefConfig = requireSefConfig(),
    private readonly request: FetchLike = fetch,
    private readonly delay: Delay = (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)),
  ) {}

  async listSalesInvoiceIds(input: {
    status?: string;
    dateFrom: Date;
    dateTo: Date;
  }) {
    if (
      Number.isNaN(input.dateFrom.getTime()) ||
      Number.isNaN(input.dateTo.getTime()) ||
      input.dateFrom >= input.dateTo
    ) {
      throw new SefApiError("SEF period nije ispravan.", null);
    }
    const url = new URL("/api/publicApi/sales-invoice/ids", this.config.baseUrl);
    url.searchParams.set("dateFrom", input.dateFrom.toISOString());
    url.searchParams.set("dateTo", input.dateTo.toISOString());
    if (input.status?.trim()) url.searchParams.set("status", input.status.trim());

    const value = await this.jsonRequest(url, { method: "POST" }, true);
    return { salesInvoiceIds: invoiceIds(value, "salesInvoiceIds") };
  }

  async listPurchaseInvoiceIds(input: { dateFrom: Date; dateTo: Date }) {
    if (!Number.isFinite(input.dateFrom.getTime()) || !Number.isFinite(input.dateTo.getTime()) || input.dateFrom >= input.dateTo) throw new SefApiError("SEF period nije ispravan.", null);
    const url = new URL("/api/publicApi/purchase-invoice/ids", this.config.baseUrl);
    url.searchParams.set("dateFrom", input.dateFrom.toISOString());
    url.searchParams.set("dateTo", input.dateTo.toISOString());
    return invoiceIds(await this.jsonRequest(url, { method: "POST" }, true), "purchaseInvoiceIds");
  }

  async purchaseInvoiceXml(id: number) {
    return this.invoiceXml("purchase", id);
  }

  async salesInvoiceXml(id: number) {
    return this.invoiceXml("sales", id);
  }

  async invoiceStatus(direction: "sales" | "purchase", id: number) {
    if (!Number.isSafeInteger(id) || id <= 0) throw new SefApiError("Neispravan SEF ID.", null);
    const url = new URL(`/api/publicApi/${direction}-invoice`, this.config.baseUrl);
    url.searchParams.set("invoiceId", String(id));
    const row = object(await this.jsonRequest(url, { method: "GET" }, true));
    const status = row?.status ?? row?.Status;
    if (typeof status !== "string" || !/^[A-Za-z][A-Za-z ]{0,50}$/.test(status)) throw new SefApiError("SEF nije vratio ispravan status fakture.", 200);
    return status;
  }

  private async invoiceXml(direction: "purchase" | "sales", id: number) {
    if (!Number.isSafeInteger(id) || id <= 0) throw new SefApiError("Neispravan SEF ID.", null);
    const url = new URL(`/api/publicApi/${direction}-invoice/xml`, this.config.baseUrl);
    url.searchParams.set("invoiceId", String(id));
    const response = await this.request(url, { headers: { accept: "application/xml", ApiKey: this.config.apiKey }, cache: "no-store", signal: AbortSignal.timeout(15_000), redirect: "error" });
    if (!response.ok) throw new SefApiError(`SEF XML je vratio HTTP ${response.status}.`, response.status, parseRetryAfter(response.headers.get("retry-after")));
    const text = await response.text();
    if (Buffer.byteLength(text) > 10 * 1024 * 1024) throw new SefApiError("SEF dokument je veći od 10 MB.", 200);
    return text;
  }

  async submitInvoice(ubl: string, requestId: string) {
    const url = new URL("/api/publicApi/sales-invoice/ubl", this.config.baseUrl);
    url.searchParams.set("requestId", requestId);
    url.searchParams.set("sendToCir", "No");
    url.searchParams.set("executeValidation", "true");
    // No automatic write retry: the provider may already have received it.
    const value = await this.jsonRequest(url, { method: "POST", headers: { "Content-Type": "application/xml" }, body: ubl }, false);
    const row = object(value);
    const id = row?.salesInvoiceId ?? row?.SalesInvoiceId ?? row?.invoiceId ?? row?.InvoiceId;
    if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0) throw new SefApiError("SEF je primio zahtev, ali nije vratio ID fakture. Proverite zahtev pre ponovnog slanja.", 200);
    return { invoiceId: id };
  }

  async healthCheck(now = new Date()) {
    const dateTo = new Date(now);
    const dateFrom = new Date(dateTo.getTime() - 24 * 60 * 60_000);
    const result = await this.listSalesInvoiceIds({ dateFrom, dateTo });
    return {
      ok: true as const,
      environment: this.config.environment,
      recentInvoiceCount: result.salesInvoiceIds.length,
    };
  }

  private async jsonRequest(
    url: URL,
    init: RequestInit,
    retrySafe: boolean,
  ): Promise<unknown> {
    const attempts = retrySafe ? 2 : 1;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      let response: Response;
      try {
        response = await this.request(url, {
          ...init,
          headers: {
            accept: "application/json",
            ApiKey: this.config.apiKey,
            ...init.headers,
          },
          cache: "no-store",
          redirect: "error",
          signal: AbortSignal.timeout(15_000),
        });
      } catch (error) {
        if (attempt < attempts) {
          await this.delay(250);
          continue;
        }
        throw new SefApiError(
          error instanceof Error
            ? `SEF nije dostupan: ${error.message}`
            : "SEF nije dostupan.",
          null,
        );
      }

      const body = await readResponse(response);
      if (response.ok) return body;

      const retryAfterSeconds = parseRetryAfter(
        response.headers.get("retry-after"),
      );
      if (
        attempt < attempts && (retryAfterSeconds === null || retryAfterSeconds <= 2) &&
        (response.status === 429 || response.status >= 500)
      ) {
        await this.delay(
          retryAfterSeconds == null
            ? 250
            : retryAfterSeconds * 1000,
        );
        continue;
      }
      throw new SefApiError(
        sefErrorMessage(response.status, body),
        response.status,
        retryAfterSeconds,
      );
    }
    throw new SefApiError("SEF zahtev nije uspeo.", null);
  }
}

async function readResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text.slice(0, 300);
  }
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function invoiceIds(value: unknown, key: "salesInvoiceIds" | "purchaseInvoiceIds") {
  const row = object(value);
  const pascal = key[0].toUpperCase() + key.slice(1);
  const ids = Array.isArray(value) ? value : row ? (key in row ? row[key] : row[pascal]) : undefined;
  if (ids === null) return [];
  if (!Array.isArray(ids) || !ids.every(id => typeof id === "number" && Number.isSafeInteger(id) && id > 0)) {
    throw new SefApiError(typeof value === "string" && /<(!doctype|html)/i.test(value)
      ? "SEF je vratio HTML umesto API odgovora. Proverite SEF_BASE_URL."
      : "SEF je vratio neočekivan format liste faktura.", 200);
  }
  return [...new Set(ids)] as number[];
}

function parseRetryAfter(value: string | null) {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, Math.ceil((date - Date.now()) / 1000)) : null;
}

function sefErrorMessage(status: number, body: unknown) {
  const detail =
    body && typeof body === "object" && !Array.isArray(body)
      ? Object.values(body as Record<string, unknown>).find(
          (value): value is string => typeof value === "string" && Boolean(value),
        )
      : typeof body === "string"
        ? body
        : null;
  // Provider errors can echo submitted XML or secrets; keep public diagnostics bounded.
  void detail;
  return `SEF je vratio HTTP ${status}.`;
}
