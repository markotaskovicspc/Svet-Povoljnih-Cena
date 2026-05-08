import "server-only";

import { createHash } from "node:crypto";
import { getFiscalConfig } from "./config";

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
}

export interface FiscalInvoiceInput {
  /** Stable idempotency key (we use `Order.number`). */
  invoiceRef: string;
  /** Total gross amount in RSD; redundant with `lines` but verified by gateway. */
  total: number;
  paymentMethod: "CASH" | "CARD" | "TRANSFER" | "OTHER";
  buyer?: {
    /** PIB for B2B receipts; absent for natural persons. */
    tin?: string;
    name?: string;
  };
  lines: FiscalInvoiceLine[];
}

export interface FiscalReceiptResponse {
  /** Provider-issued fiscal receipt number (jedinstveni identifikator računa). */
  receiptNumber: string;
  /** URL that opens the official Poreska Uprava verification page. */
  qrUrl: string | null;
  /** ISO timestamp of fiscalization. */
  fiscalizedAt: string;
  /** Provider raw payload (stored verbatim for audit). */
  raw: unknown;
}

export type FiscalDispatchResult =
  | { ok: true; provider: "efiskal" | "none"; receipt: FiscalReceiptResponse }
  | { ok: false; provider: "efiskal" | "none"; error: string };

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

  if (cfg.provider === "none" || !cfg.apiKey) {
    // Deterministic dev stub: the receipt number is derived from the
    // invoice ref so retries collapse to the same value.
    const hash = createHash("sha1").update(input.invoiceRef).digest("hex");
    const receiptNumber = `DEV-${hash.slice(0, 8).toUpperCase()}-${hash
      .slice(8, 12)
      .toUpperCase()}`;
    const qrUrl = `${cfg.baseUrl}/api/fiscal/qr?ref=${encodeURIComponent(
      input.invoiceRef,
    )}`;
    console.info(
      `[fiscal:dev] ref=${input.invoiceRef} total=${input.total} → ${receiptNumber}`,
    );
    return {
      ok: true,
      provider: "none",
      receipt: {
        receiptNumber,
        qrUrl,
        fiscalizedAt: new Date().toISOString(),
        raw: { dev: true, ref: input.invoiceRef },
      },
    };
  }

  const body = {
    reference: input.invoiceRef,
    tin: cfg.tin,
    location: cfg.locationId,
    cashier: cfg.cashier,
    invoiceType: cfg.defaultInvoiceType,
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
        "Idempotency-Key": input.invoiceRef,
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
