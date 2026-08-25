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
    if (!isSalesInvoiceIdsResponse(value)) {
      throw new SefApiError("SEF je vratio neočekivan odgovor.", 200);
    }
    return { salesInvoiceIds: value.salesInvoiceIds ?? [] };
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
        attempt < attempts &&
        (response.status === 429 || response.status >= 500)
      ) {
        await this.delay(
          retryAfterSeconds == null
            ? 250
            : Math.min(retryAfterSeconds * 1000, 2_000),
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

function isSalesInvoiceIdsResponse(
  value: unknown,
): value is { salesInvoiceIds: number[] | null } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const ids = (value as Record<string, unknown>).salesInvoiceIds;
  return (
    ids === null ||
    (Array.isArray(ids) && ids.every((id) => Number.isSafeInteger(id)))
  );
}

function parseRetryAfter(value: string | null) {
  if (!value) return null;
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
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
  return `SEF je vratio HTTP ${status}${detail ? `: ${detail.slice(0, 240)}` : ""}`;
}
