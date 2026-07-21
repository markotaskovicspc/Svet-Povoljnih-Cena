import "server-only";

import type { Supplier } from "@prisma/client";
import { envValue } from "@/lib/env";

export const RABALUX_INTEGRATION_KEY = "RABALUX";

export function isRabaluxEnabled() {
  return ["1", "true", "yes", "on"].includes(
    (envValue("RABALUX_ENABLED") ?? "").toLowerCase(),
  );
}

export function isRabaluxSupplierOperational(
  supplier: Pick<Supplier, "integrationKey" | "enabled"> | null | undefined,
) {
  return Boolean(
    supplier?.integrationKey === RABALUX_INTEGRATION_KEY &&
      supplier.enabled &&
      isRabaluxEnabled(),
  );
}

function resolveSecret(reference: string | null, fallbackName: string) {
  const envName = reference?.match(/^env:([A-Z0-9_]+)$/i)?.[1] ?? fallbackName;
  return envValue(envName);
}

export function rabaluxCatalogCredentials(supplier: Supplier) {
  return {
    user: resolveSecret(supplier.authUser, "RABALUX_CATALOG_USER"),
    pass: resolveSecret(supplier.authPass, "RABALUX_CATALOG_PASS"),
  };
}

export function rabaluxStockCredentials(supplier: Supplier) {
  return {
    user: resolveSecret(supplier.stockAuthUser, "RABALUX_STOCK_USER"),
    pass: resolveSecret(supplier.stockAuthPass, "RABALUX_STOCK_PASS"),
  };
}

export async function fetchRabaluxFeed(
  url: string,
  credentials: { user: string | null; pass: string | null },
  accept: string,
) {
  if (!credentials.user || !credentials.pass) {
    throw new Error("Rabalux feed credentials are not configured.");
  }
  const attempts = 3;
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120_000);
    try {
      const response = await fetch(url, {
        cache: "no-store",
        signal: controller.signal,
        headers: {
          Accept: accept,
          Authorization: `Basic ${Buffer.from(
            `${credentials.user}:${credentials.pass}`,
          ).toString("base64")}`,
          "User-Agent": "SvetPovoljnihCena-Rabalux/1.0",
        },
      });
      if (response.ok) return response.text();
      const error = new Error(`Rabalux feed returned HTTP ${response.status}.`);
      if (!isRetryableFeedStatus(response.status) || attempt === attempts) throw error;
      lastError = error;
      await retryDelay(attempt, response.headers.get("retry-after"));
    } catch (error) {
      lastError = error;
      if (attempt === attempts || isPermanentFetchError(error)) throw error;
      await retryDelay(attempt);
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Rabalux feed fetch failed.");
}

function isRetryableFeedStatus(status: number) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function isPermanentFetchError(error: unknown) {
  return (
    error instanceof Error &&
    /HTTP (?:400|401|403|404|405|406|409|410|422)\b/.test(error.message)
  );
}

async function retryDelay(attempt: number, retryAfter?: string | null) {
  const headerSeconds = retryAfter ? Number(retryAfter) : Number.NaN;
  const baseMs = Number.isFinite(headerSeconds)
    ? Math.min(Math.max(headerSeconds, 0), 10) * 1_000
    : 250 * 2 ** (attempt - 1);
  const jitterMs = Math.floor(Math.random() * 150);
  await new Promise((resolve) => setTimeout(resolve, baseMs + jitterMs));
}
