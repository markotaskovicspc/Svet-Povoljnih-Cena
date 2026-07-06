import "server-only";

import { createHash } from "node:crypto";
import { getFiscalConfig, type FiscalProvider } from "./config";
import { fiscalizeWithBadi, isBadiConfigured } from "./badi";

/**
 * Phase 4F — provider-agnostic dispatcher for the eFiskal gateway.
 *
 * The contract is intentionally minimal: providers vary wildly in how
 * they expose LPFR/SUF, so we POST a normalized invoice body and trust
 * the gateway to produce a fiscally valid receipt. The dummy `none`
 * provider mirrors the same shape with deterministic values so the rest
 * of the pipeline (PDF, email, admin UI) can be exercised end-to-end in
 * dev without a real gateway.
 *
 * Idempotency is the caller's responsibility: pass a stable
 * `invoiceRef` (we use `Order.number`). The gateway is expected to
 * deduplicate on this value.
 */

export interface FiscalInvoiceLine {
  /** Internal SKU; surfaced as `gtin`/`code` to the gateway. */
  sku: string;
  name: string;
  qty: number;
  /** Per-unit gross price in RSD (incl. VAT). */
  unitPrice: number;
  vatLabel?: string;
  /** Service lines (shipping) are registered as `type: "service"` articles. */
  isService?: boolean;
}

export interface FiscalInvoiceInput {
  /** Stable idempotency key (we use `Order.number`). */
  invoiceRef: string;
  /** Defaults to SALE; REFUND maps to a Taxcore refund/storno payload. */
  transactionType?: "SALE" | "REFUND";
  /** Gateway-specific invoice type. Defaults to the configured NORMAL type. */
  invoiceType?: "NORMAL" | "ADVANCE" | "REFUND";
  /** Original fiscal receipt number required for refund documents. */
  originalReceiptNumber?: string | null;
  /** Optional explicit idempotency key; falls back to invoiceRef. */
  idempotencyKey?: string;
  /** Total gross amount in RSD; redundant with `lines` but verified by gateway. */
  total: number;
  paymentMethod: "CASH" | "CARD" | "TRANSFER" | "OTHER";
  buyer?: {
    /** PIB for B2B receipts; absent for natural persons. */
    tin?: string;
    name?: string;
  };
  /**
   * Buyer identification in Tax Authority format (e.g. `10:<PIB>`,
   * `11:<JMBG>`). Mandatory for refunds; derived from `buyer.tin` for
   * B2B sales when absent.
   */
  buyerId?: string | null;
  lines: FiscalInvoiceLine[];
}

export interface FiscalReceiptResponse {
  /** Provider-issued fiscal receipt number (jedinstveni identifikator računa). */
  receiptNumber: string;
  /** URL that opens the official Poreska Uprava verification page. */
  qrUrl: string | null;
  /** ISO timestamp of fiscalization. */
  fiscalizedAt: string;
  /** Official receipt PDF (QR + signature) when the provider returns one. */
  pdfBase64?: string | null;
  /** Provider raw payload (stored verbatim for audit). */
  raw: unknown;
}

export type FiscalDispatchResult =
  | { ok: true; provider: FiscalProvider; receipt: FiscalReceiptResponse }
  | { ok: false; provider: FiscalProvider; error: string };

/**
 * Submit a fiscal invoice to the configured gateway.
 *
 * Logical errors (4xx with a JSON body) are returned as `ok:false`;
 * network failures bubble up so the caller can decide whether to retry.
 */
export async function fiscalize(
  input: FiscalInvoiceInput,
): Promise<FiscalDispatchResult> {
  const cfg = getFiscalConfig();

  const badiReady = cfg.provider === "badi" && isBadiConfigured(cfg.badi);
  const efiskalReady = cfg.provider === "efiskal" && Boolean(cfg.apiKey);

  if (!badiReady && !efiskalReady) {
    // Deterministic dev stub: the receipt number is derived from the
    // invoice ref so retries collapse to the same value.
    const key = input.idempotencyKey ?? input.invoiceRef;
    const hash = createHash("sha1").update(key).digest("hex");
    const prefix = input.transactionType === "REFUND" ? "DEV-R" : "DEV";
    const receiptNumber = `${prefix}-${hash.slice(0, 8).toUpperCase()}-${hash
      .slice(8, 12)
      .toUpperCase()}`;
    const qrUrl = `${cfg.baseUrl}/api/fiscal/qr?ref=${encodeURIComponent(
      key,
    )}`;
    console.info(
      `[fiscal:dev] ref=${key} type=${input.transactionType ?? "SALE"} total=${input.total} → ${receiptNumber}`,
    );
    return {
      ok: true,
      provider: "none",
      receipt: {
        receiptNumber,
        qrUrl,
        fiscalizedAt: new Date().toISOString(),
        raw: {
          dev: true,
          ref: key,
          transactionType: input.transactionType ?? "SALE",
          originalReceiptNumber: input.originalReceiptNumber ?? null,
        },
      },
    };
  }

  if (cfg.provider === "badi") {
    return fiscalizeWithBadi(input);
  }

  const body = {
    reference: input.invoiceRef,
    tin: cfg.tin,
    location: cfg.locationId,
    cashier: cfg.cashier,
    invoiceType: input.invoiceType ?? cfg.defaultInvoiceType,
    transactionType: input.transactionType ?? "SALE",
    originalReceiptNumber: input.originalReceiptNumber ?? null,
    paymentMethod: input.paymentMethod,
    buyer: input.buyer ?? null,
    total: input.total,
    items: input.lines.map((l) => ({
      code: l.sku,
      name: l.name,
      quantity: l.qty,
      unitPrice: l.unitPrice,
      vatLabel: l.vatLabel ?? cfg.defaultVatLabel,
    })),
  };

  let res: Response;
  try {
    res = await fetch(cfg.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.apiKey}`,
        "Idempotency-Key": input.idempotencyKey ?? input.invoiceRef,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, provider: "efiskal", error: `fiscal:network ${message}` };
  }

  const json = (await res.json().catch(() => ({}))) as {
    receiptNumber?: string;
    invoiceNumber?: string;
    qrUrl?: string;
    qr_url?: string;
    fiscalizedAt?: string;
    error?: string;
    message?: string;
  };

  const receiptNumber = json.receiptNumber ?? json.invoiceNumber;
  if (!res.ok || !receiptNumber) {
    return {
      ok: false,
      provider: "efiskal",
      error: `fiscal:${res.status} ${json.error ?? json.message ?? "unknown"}`,
    };
  }

  return {
    ok: true,
    provider: "efiskal",
    receipt: {
      receiptNumber,
      qrUrl: json.qrUrl ?? json.qr_url ?? null,
      fiscalizedAt: json.fiscalizedAt ?? new Date().toISOString(),
      raw: json,
    },
  };
}
