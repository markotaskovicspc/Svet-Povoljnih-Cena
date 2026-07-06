import "server-only";

import { db } from "@/lib/db";
import { getFiscalConfig, type BadiConfig } from "./config";
import type {
  FiscalDispatchResult,
  FiscalInvoiceInput,
  FiscalInvoiceLine,
} from "./transport";

/**
 * badi.rs eFiskalizacija adapter (API v2).
 *
 * The public API docs (https://badi.rs/api-docs/) are explicitly
 * incomplete, so every assumption about request shapes lives in this
 * file only:
 *   - receipts reference articles by SKU, so `ensureBadiProducts()`
 *     lazily registers unknown SKUs in badi's catalog first;
 *   - `RECEIPT_DELIVERY` requests a base64 PDF (the official receipt
 *     with QR verification) — badi's `pdf` URL variant expires after
 *     10 minutes and must not be persisted;
 *   - refunds are issued against the original receipt number and
 *     legally require a buyer identification (`buyerId`).
 *
 * badi has no idempotency mechanism: callers must not re-dispatch a
 * request whose response may have been lost (see retry.ts).
 */

const RECEIPT_DELIVERY = { base64pdf: true };

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
  init: { method: "GET" | "POST" | "PATCH"; body?: unknown },
): Promise<BadiResult<T>> {
  const { badi } = getFiscalConfig();
  const auth = Buffer.from(`${badi.apiKey}:${badi.apiSecret}`).toString("base64");

  let res: Response;
  try {
    res = await fetch(`${badi.baseUrl}${path}`, {
      method: init.method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${auth}`,
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
    result = await badiRequest<BadiReceiptResponse>(
      `/fiscalization/receipts/${encodeURIComponent(input.originalReceiptNumber)}/refund`,
      {
        method: "POST",
        body: {
          ...(badi.clientId ? { clientId: badi.clientId } : {}),
          buyerId: input.buyerId,
          payments: { [PAYMENT_KEYS[input.paymentMethod]]: input.total },
          items: input.lines.map((line) => ({ sku: line.sku, quantity: line.qty })),
          receiptDelivery: RECEIPT_DELIVERY,
        },
      },
    );
  } else {
    await ensureBadiProducts(input.lines);
    const body = {
      ...(badi.clientId ? { clientId: badi.clientId } : {}),
      invoiceType: "normal",
      transactionType: "sale",
      ...(input.buyerId ?? input.buyer?.tin
        ? { buyerId: input.buyerId ?? `10:${input.buyer!.tin}` }
        : {}),
      payments: { [PAYMENT_KEYS[input.paymentMethod]]: input.total },
      items: input.lines.map((line) => ({
        sku: line.sku,
        quantity: line.qty,
        unitPrice: line.unitPrice,
      })),
      receiptDelivery: RECEIPT_DELIVERY,
    };
    result = await badiRequest<BadiReceiptResponse>("/fiscalization/receipts", {
      method: "POST",
      body,
    });
    if (!result.ok && isUnknownSkuError(result)) {
      // The local sync record may be stale (product deleted in badi's
      // dashboard) — force a re-registration and retry exactly once.
      await ensureBadiProducts(input.lines, { force: true });
      result = await badiRequest<BadiReceiptResponse>("/fiscalization/receipts", {
        method: "POST",
        body,
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

function isUnknownSkuError(error: BadiError): boolean {
  if (error.code !== 40090001) return false;
  const validation = JSON.stringify(error.validation ?? "").toLowerCase();
  return validation.includes("sku") || validation.includes("item");
}

/**
 * Lazily register receipt SKUs in badi's product catalog.
 *
 * badi receipts carry `unitPrice` per item, so price drift is
 * irrelevant — only existence (and name, best-effort) matters. Synced
 * SKUs are recorded in `FiscalProductSync` to avoid re-posting on
 * every receipt.
 */
export async function ensureBadiProducts(
  lines: Pick<FiscalInvoiceLine, "sku" | "name" | "isService">[],
  opts: { force?: boolean } = {},
): Promise<void> {
  const { badi } = getFiscalConfig();
  const bySku = new Map(lines.map((line) => [line.sku, line]));
  if (!bySku.size) return;

  const synced = opts.force
    ? []
    : await db.fiscalProductSync.findMany({
        where: { provider: "badi", sku: { in: [...bySku.keys()] } },
        select: { sku: true },
      });
  const syncedSkus = new Set(synced.map((row) => row.sku));

  for (const [sku, line] of bySku) {
    if (syncedSkus.has(sku)) continue;

    const result = await badiRequest<{ id?: string; productId?: string }>("/products", {
      method: "POST",
      body: {
        ...(badi.clientId ? { clientId: badi.clientId } : {}),
        sku,
        name: line.name,
        taxRateLabel: badi.taxRateLabel,
        ...(line.isService ? { type: "service" } : {}),
      },
    });

    // A duplicate/exists rejection means the product is already in
    // badi's catalog — record it locally and move on. Anything else is
    // fatal for the receipt that references this SKU.
    if (!result.ok && !isDuplicateProductError(result)) {
      throw new Error(`badi products sync (${sku}): ${result.error}`);
    }

    const providerId = result.ok ? result.data.id ?? result.data.productId ?? null : null;
    await db.fiscalProductSync.upsert({
      where: { provider_sku: { provider: "badi", sku } },
      create: {
        provider: "badi",
        sku,
        name: line.name,
        taxRateLabel: badi.taxRateLabel,
        isService: line.isService ?? false,
        providerId,
      },
      update: { name: line.name, syncedAt: new Date(), ...(providerId ? { providerId } : {}) },
    });
  }
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
