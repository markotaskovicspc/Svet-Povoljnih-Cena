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
    if (!response.ok) {
      throw new Error(`Rabalux feed returned HTTP ${response.status}.`);
    }
    return response.text();
  } finally {
    clearTimeout(timeout);
  }
}
