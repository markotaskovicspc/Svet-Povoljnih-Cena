import "server-only";

import { db } from "@/lib/db";
import { envValue } from "@/lib/env";
import { getFiscalConfig, type BadiConfig } from "./config";
import type {
  FiscalDispatchResult,
  FiscalInvoiceInput,
  FiscalInvoiceLine,
} from "./transport";

/**
 * badi.rs eFiskalizacija adapter (API v2).
 *
 * Contract facts below are from a live spike against
 * api.production.badi.rs/v2 (2026-07-10), which corrected several
 * assumptions in the public docs (https://badi.rs/api-docs/):
 *
 *   - POST /products: `sku` must be a NUMBER, not a string. `productType`
 *     (enum "product" | "service" | "digital") is REQUIRED. `clientId`
 *     is NOT allowed on this endpoint (400 "clientId is not allowed").
 *     If `sku` is omitted, badi AUTO-ASSIGNS a numeric sku (verified: an
 *     empty catalog returns sku 1, 2, …) and echoes it back in the
 *     response. Our internal SKUs are strings and often non-numeric
 *     (e.g. "DOSTAVA", "relax-1133"), so `ensureBadiProducts()` sends the
 *     internal sku as a number only when it is all-digits, and otherwise
 *     lets badi auto-assign. The resulting NUMERIC sku is persisted in
 *     `FiscalProductSync.providerSku`; receipt items reference THAT, never
 *     the internal string sku (badi would 400 on a string sku).
 *
 *   - POST /fiscalization/receipts: requires `storeId` (400
 *     "storeId is required" when only `clientId` is sent). The dashboard's
 *     "ID klijenta" UUID doubles as the storeId value. With `storeId`
 *     present the request reaches badi's relay layer, which dispatches the
 *     receipt over a websocket to a CONNECTED fiscal processor (PFR).
 *     With no PFR connected the spike got 400 errorCode 40080001
 *     "No client with the given storeId or clientId is connected".
 *     End-to-end receipt issuance therefore CANNOT be verified until the
 *     client connects a fiscal processor in the badi dashboard — the code
 *     below is contract-ready for that moment.
 *
 *   - invoiceType enum: "normal" | "advance" | "proforma" | "training".
 *     "training" (obuka) is the legally-non-fiscal test mode; the sale
 *     invoiceType is driven by `BADI_INVOICE_TYPE` (default "normal") so we
 *     can run legally-safe E2E "training" receipts once a PFR is connected.
 *
 *   - `RECEIPT_DELIVERY` requests a base64 PDF (the official receipt with
 *     QR verification) — badi's `pdf` URL variant expires after 10 minutes
 *     and must not be persisted.
 *
 *   - refunds are issued against the original receipt number and legally
 *     require a buyer identification (`buyerId`).
 *
 * badi has no idempotency mechanism: callers must not re-dispatch a
 * request whose response may have been lost (see retry.ts).
 */

const RECEIPT_DELIVERY = { base64pdf: true };

/**
 * Fallback numeric-sku sequence floor. Only used if badi's auto-assign
 * (POST /products without `sku`) is ever unavailable: we derive a fresh
 * numeric sku as `max(existing FiscalProductSync.providerSku, floor-1) + 1`.
 * Chosen high enough not to collide with badi's own low auto-assigned
 * counter (verified starting at 1) or with numeric internal SKUs.
 */
const PROVIDER_SKU_FLOOR = 900001;

/**
 * Resolve the sale invoiceType from `BADI_INVOICE_TYPE`.
 * "training" (obuka) issues legally-non-fiscal receipts for E2E testing;
 * anything else (incl. unset) falls back to "normal".
 */
function saleInvoiceType(): "normal" | "training" {
  return envValue("BADI_INVOICE_TYPE") === "training" ? "training" : "normal";
}

/** Payment map: normalized gateway methods → badi `payments` keys. */
const PAYMENT_KEYS: Record<FiscalInvoiceInput["paymentMethod"], string> = {
  CASH: "cash",
  CARD: "card",
  TRANSFER: "wiretransfer",
  OTHER: "other",
};

type BadiReceiptResponse = {
  invoiceNumber?: string;
  invoiceCounter?: string;
  sdcDateTime?: string;
  verificationUrl?: string;
  verificationQRCode?: string;
  totalAmount?: number;
  taxItems?: unknown[];
  signature?: string;
  journal?: string;
  pdf?: string;
  base64pdf?: string;
  [key: string]: unknown;
};

type BadiError = {
  ok: false;
  status: number;
  code: number | null;
  error: string;
  validation: unknown;
};

type BadiResult<T> = { ok: true; data: T } | BadiError;

export function isBadiConfigured(badi: BadiConfig): boolean {
  return Boolean(badi.apiKey && badi.apiSecret);
}

async function badiRequest<T>(
  path: string,
  init: { method: "GET" | "POST" | "PATCH" | "DELETE"; body?: unknown; vpfr?: boolean },
): Promise<BadiResult<T>> {
  const { badi } = getFiscalConfig();
  const auth = Buffer.from(`${badi.apiKey}:${badi.apiSecret}`).toString("base64");

  // VPFR certificate mode (badi api-docs): receipt endpoints accept pfx/
  // password/pac headers so fiscalization runs through the Tax Authority's
  // cloud V-PFR instead of a locally connected LPFR client. Exact header
  // encoding (raw vs base64 pfx) is unverified until a live E2E — revisit then.
  const vpfrHeaders: Record<string, string> =
    init.vpfr && badi.vpfr
      ? { pfx: badi.vpfr.pfx, password: badi.vpfr.password, pac: badi.vpfr.pac }
      : {};

  let res: Response;
  try {
    res = await fetch(`${badi.baseUrl}${path}`, {
      method: init.method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${auth}`,
        ...vpfrHeaders,
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, status: 0, code: null, validation: null, error: `fiscal:network ${message}` };
  }

  const json = (await res.json().catch(() => ({}))) as {
    code?: number;
    message?: string;
    error?: string;
    validation?: unknown;
  } & T;

  if (!res.ok) {
    const code = typeof json.code === "number" ? json.code : null;
    const detail = json.message ?? json.error ?? "unknown";
    const validation = json.validation ? ` ${JSON.stringify(json.validation)}` : "";
    return {
      ok: false,
      status: res.status,
      code,
      validation: json.validation ?? null,
      error: `fiscal:${res.status}:${code ?? "-"} ${detail}${validation}`,
    };
  }

  return { ok: true, data: json };
}

export async function fiscalizeWithBadi(
  input: FiscalInvoiceInput,
): Promise<FiscalDispatchResult> {
  const { badi } = getFiscalConfig();
  const transactionType = input.transactionType ?? "SALE";

  // storeId is REQUIRED by the receipt endpoints; the badi dashboard's
  // "ID klijenta" UUID doubles as its value. We keep `clientId` alongside
  // belt-and-braces (extra body keys were tolerated in the live spike).
  const storeIdentity = badi.clientId
    ? { storeId: badi.clientId, clientId: badi.clientId }
    : {};

  let result: BadiResult<BadiReceiptResponse>;
  if (transactionType === "REFUND") {
    if (!input.originalReceiptNumber) {
      return {
        ok: false,
        provider: "badi",
        error: "fiscal:badi refundacija zahteva broj originalnog fiskalnog računa.",
      };
    }
    if (!input.buyerId) {
      return {
        ok: false,
        provider: "badi",
        error: "fiscal:badi refundacija zahteva identifikaciju kupca (buyerId).",
      };
    }
    // Register products first so refund items can carry the NUMERIC sku too.
    const providerSkus = await ensureBadiProducts(input.lines);
    result = await badiRequest<BadiReceiptResponse>(
      `/fiscalization/receipts/${encodeURIComponent(input.originalReceiptNumber)}/refund`,
      {
        method: "POST",
        vpfr: true,
        body: {
          ...storeIdentity,
          buyerId: input.buyerId,
          payments: { [PAYMENT_KEYS[input.paymentMethod]]: input.total },
          items: input.lines.map((line) => ({
            sku: providerSkus.get(line.sku),
            quantity: line.qty,
          })),
          receiptDelivery: RECEIPT_DELIVERY,
        },
      },
    );
  } else {
    let providerSkus = await ensureBadiProducts(input.lines);
    const buildBody = (skus: Map<string, number>) => ({
      ...storeIdentity,
      invoiceType: saleInvoiceType(),
      transactionType: "sale",
      ...(input.buyerId ?? input.buyer?.tin
        ? { buyerId: input.buyerId ?? `10:${input.buyer!.tin}` }
        : {}),
      payments: { [PAYMENT_KEYS[input.paymentMethod]]: input.total },
      items: input.lines.map((line) => ({
        sku: skus.get(line.sku),
        quantity: line.qty,
        unitPrice: line.unitPrice,
      })),
      receiptDelivery: RECEIPT_DELIVERY,
    });
    result = await badiRequest<BadiReceiptResponse>("/fiscalization/receipts", {
      method: "POST",
      vpfr: true,
      body: buildBody(providerSkus),
    });
    if (!result.ok && isUnknownSkuError(result)) {
      // The local sync record may be stale (product deleted in badi's
      // dashboard) — force a re-registration and retry exactly once.
      providerSkus = await ensureBadiProducts(input.lines, { force: true });
      result = await badiRequest<BadiReceiptResponse>("/fiscalization/receipts", {
        method: "POST",
        vpfr: true,
        body: buildBody(providerSkus),
      });
    }
  }

  if (!result.ok) {
    return { ok: false, provider: "badi", error: result.error };
  }

  const receipt = result.data;
  if (!receipt.invoiceNumber) {
    return {
      ok: false,
      provider: "badi",
      error: "fiscal:badi odgovor ne sadrži invoiceNumber.",
    };
  }

  // The base64 PDF is returned separately and stripped from the audit
  // payload — a multi-hundred-kB blob inside `rawResponse` Json would
  // bloat every FiscalDocument row. The `pdf` URL variant expires in
  // 10 minutes, so it is dropped too.
  const { base64pdf, ...raw } = receipt;
  delete raw.pdf;

  return {
    ok: true,
    provider: "badi",
    receipt: {
      receiptNumber: receipt.invoiceNumber,
      qrUrl: receipt.verificationUrl ?? null,
      fiscalizedAt: receipt.sdcDateTime ?? new Date().toISOString(),
      pdfBase64: base64pdf ?? null,
      raw,
    },
  };
}

/**
 * True only when a receipt was rejected because it references an article
 * that does not exist in badi's catalog (justifying a force-resync + retry).
 *
 * CAUTION: 40090001 is badi's GENERIC validation errorCode — the live spike
 * observed it for "sku must be a number", "productType is required" and
 * "limit not allowed" alike. Matching on the code plus a bare "sku" mention
 * would wrongly force-resync on unrelated validation failures, so we require
 * the validation text to actually indicate a MISSING/UNKNOWN article
 * ("not found", "does not exist", "unknown", "nepostoj*", "ne postoji").
 * Merely mentioning "sku" is not enough.
 */
function isUnknownSkuError(error: BadiError): boolean {
  if (error.code !== 40090001) return false;
  const text = [
    JSON.stringify(error.validation ?? ""),
    error.error,
  ]
    .join(" ")
    .toLowerCase();
  const mentionsArticle =
    text.includes("sku") || text.includes("item") || text.includes("product") || text.includes("artikl");
  const mentionsMissing =
    text.includes("not found") ||
    text.includes("does not exist") ||
    text.includes("doesn't exist") ||
    text.includes("no such") ||
    text.includes("unknown") ||
    text.includes("nepostoj") ||
    text.includes("ne postoji");
  return mentionsArticle && mentionsMissing;
}

/** A string sku that is safe to send to badi as a NUMBER, or null. */
function numericSku(sku: string): number | null {
  if (!/^\d+$/.test(sku)) return null;
  const n = Number(sku);
  return Number.isSafeInteger(n) ? n : null;
}

/**
 * Lazily register receipt SKUs in badi's product catalog and return a map
 * of internal string sku → badi NUMERIC sku (which receipt items must use).
 *
 * badi requires `sku` to be a NUMBER. Our internal SKUs are strings and
 * often non-numeric ("DOSTAVA", "relax-1133"), so:
 *   - all-digit internal SKUs are sent to badi verbatim as a number;
 *   - otherwise `sku` is OMITTED and badi AUTO-ASSIGNS a numeric sku,
 *     which it echoes back and we persist in `providerSku`.
 * If auto-assign is ever unavailable, we fall back to deriving a numeric
 * sku from a dedicated sequence (`PROVIDER_SKU_FLOOR`+).
 *
 * badi receipts carry `unitPrice` per item, so price drift is irrelevant —
 * only existence (and name, best-effort) matters. Results are recorded in
 * `FiscalProductSync` to avoid re-posting on every receipt.
 */
export async function ensureBadiProducts(
  lines: Pick<FiscalInvoiceLine, "sku" | "name" | "isService">[],
  opts: { force?: boolean } = {},
): Promise<Map<string, number>> {
  const { badi } = getFiscalConfig();
  const providerSkus = new Map<string, number>();
  const bySku = new Map(lines.map((line) => [line.sku, line]));
  if (!bySku.size) return providerSkus;

  const synced = opts.force
    ? []
    : await db.fiscalProductSync.findMany({
        where: { provider: "badi", sku: { in: [...bySku.keys()] } },
        select: { sku: true, providerSku: true },
      });
  const syncedSkus = new Set<string>();
  for (const row of synced) {
    if (row.providerSku != null) {
      providerSkus.set(row.sku, row.providerSku);
      syncedSkus.add(row.sku);
    }
    // A row without providerSku predates this column — re-register so the
    // numeric sku gets backfilled (receipt items cannot use the string sku).
  }

  for (const [sku, line] of bySku) {
    if (syncedSkus.has(sku)) continue;

    const explicitSku = numericSku(sku);
    const productType = line.isService ? "service" : "product";

    const result = await badiRequest<{
      id?: string;
      productId?: string;
      sku?: number | string;
    }>("/products", {
      method: "POST",
      body: {
        // NOTE: `clientId` is NOT allowed on POST /products (badi 400s).
        ...(explicitSku != null ? { sku: explicitSku } : {}),
        name: line.name,
        taxRateLabel: badi.taxRateLabel,
        productType,
      },
    });

    // A duplicate/exists rejection means the product is already in badi's
    // catalog. Anything else is fatal for the receipt referencing this SKU.
    if (!result.ok && !isDuplicateProductError(result)) {
      throw new Error(`badi products sync (${sku}): ${result.error}`);
    }

    const providerId = result.ok ? result.data.id ?? result.data.productId ?? null : null;

    // Resolve the NUMERIC sku: prefer badi's echoed value, then the explicit
    // numeric internal sku, then a derived sequence value (auto-assign
    // fallback / duplicate where badi didn't echo a sku).
    let providerSku: number;
    const echoed = result.ok ? toNumericSku(result.data.sku) : null;
    if (echoed != null) {
      providerSku = echoed;
    } else if (explicitSku != null) {
      providerSku = explicitSku;
    } else {
      providerSku = await nextProviderSku();
    }
    providerSkus.set(sku, providerSku);

    await db.fiscalProductSync.upsert({
      where: { provider_sku: { provider: "badi", sku } },
      create: {
        provider: "badi",
        sku,
        name: line.name,
        taxRateLabel: badi.taxRateLabel,
        isService: line.isService ?? false,
        providerId,
        providerSku,
      },
      update: {
        name: line.name,
        syncedAt: new Date(),
        providerSku,
        ...(providerId ? { providerId } : {}),
      },
    });
  }

  return providerSkus;
}

/** Coerce badi's echoed `sku` (number or numeric string) to a number, or null. */
function toNumericSku(value: number | string | undefined): number | null {
  if (typeof value === "number") return Number.isSafeInteger(value) ? value : null;
  if (typeof value === "string" && /^\d+$/.test(value)) {
    const n = Number(value);
    return Number.isSafeInteger(n) ? n : null;
  }
  return null;
}

/**
 * Fallback numeric-sku allocator, used only when badi neither accepts an
 * explicit numeric sku nor echoes an auto-assigned one. Monotonic above
 * PROVIDER_SKU_FLOOR based on the current max persisted `providerSku`.
 */
async function nextProviderSku(): Promise<number> {
  const top = await db.fiscalProductSync.aggregate({
    where: { provider: "badi" },
    _max: { providerSku: true },
  });
  const current = top._max.providerSku ?? PROVIDER_SKU_FLOOR - 1;
  return Math.max(current, PROVIDER_SKU_FLOOR - 1) + 1;
}

function isDuplicateProductError(error: BadiError): boolean {
  if (error.status !== 400 && error.status !== 409) return false;
  const text = error.error.toLowerCase();
  return (
    text.includes("exist") ||
    text.includes("duplicate") ||
    text.includes("već postoji") ||
    text.includes("vec postoji")
  );
}
