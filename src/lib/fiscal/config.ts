import "server-only";
import { envValue } from "@/lib/env";

/**
 * Phase 4F — Elektronski fiskalni račun configuration.
 *
 * Provider is selected via `FISCAL_PROVIDER`:
 *   - `badi`    → badi.rs eFiskalizacija REST API (v2). Basic-auth
 *                 credentials come from `BADI_API_KEY`/`BADI_API_SECRET`,
 *                 environment from `BADI_ENV` (sandbox|production).
 *   - `efiskal` → Generic HTTP gateway compatible with Serbian SUF /
 *                 LPFR providers (Pantheon, eRačun, Galeb, …). The
 *                 gateway is expected to accept a JSON invoice and
 *                 return `{ receiptNumber, qrUrl, signature, … }`.
 *   - `none`    → Dev/preview stub: `fiscalize()` returns a deterministic
 *                 dummy receipt without contacting any external service.
 *
 * Only `provider`, `endpoint`, `apiKey`, `tin` (PIB) and `locationId`
 * vary per environment; everything else has sensible defaults.
 */

export type FiscalProvider = "efiskal" | "badi" | "none";

export interface BadiConfig {
  apiKey: string | null;
  apiSecret: string | null;
  /** v2 REST base URL, derived from `BADI_ENV` unless `BADI_BASE_URL` overrides it. */
  baseUrl: string;
  /** Required by badi in public-API mode; optional for single-client accounts. */
  clientId: string | null;
  /** Sales-location UUID required by badi's VPFR certificate mode. */
  storeId: string | null;
  /** Cashier/user identifier printed on receipts in VPFR certificate mode. */
  cashierId: string | null;
  /** Explicit transport mode; VPFR fails closed unless the certificate trio is complete. */
  fiscalMode: "public" | "vpfr";
  /** Tax rate label registered with badi products ("Ђ" = 20 % standard). */
  taxRateLabel: string;
  /**
   * VPFR certificate mode (badi api-docs: optional `pfx`/`password`/`pac`
   * headers on receipt endpoints) — routes fiscalization through the Tax
   * Authority's cloud V-PFR instead of a locally connected LPFR, so no
   * always-on machine is needed. Set all three or none.
   */
  vpfr: { pfx: string; password: string; pac: string } | null;
}

export interface FiscalConfig {
  provider: FiscalProvider;
  /** Bearer token for the SUF gateway. */
  apiKey: string | null;
  /** HTTPS endpoint of the SUF gateway (`/invoices` is appended). */
  endpoint: string;
  /** Tax identification number of the merchant (PIB). */
  tin: string;
  /** Merchant location id registered with the Tax Administration (jedinstveni identifikator poslovnog prostora). */
  locationId: string;
  /** Cashier identifier surfaced on the printed receipt. */
  cashier: string;
  /** Default VAT rate label sent for each invoice line (Δ = 20 % standard). */
  defaultVatLabel: string;
  /** Default invoice type — `NORMAL` for cash sales, `ADVANCE` for predračun. */
  defaultInvoiceType: "NORMAL" | "ADVANCE";
  /** Public base URL used to sign QR fallback links. */
  baseUrl: string;
  /** badi.rs credentials; only meaningful when provider === "badi". */
  badi: BadiConfig;
}

const BADI_BASE_URLS: Record<string, string> = {
  sandbox: "https://api.sandbox.badi.rs/v2",
  production: "https://api.production.badi.rs/v2",
};

let cached: FiscalConfig | null = null;

export function getFiscalConfig(): FiscalConfig {
  if (cached) return cached;
  const raw = (process.env.FISCAL_PROVIDER ?? "none").toLowerCase();
  const provider: FiscalProvider =
    raw === "efiskal" ? "efiskal" : raw === "badi" ? "badi" : "none";

  const badiEnv = (envValue("BADI_ENV") ?? "sandbox").toLowerCase();

  const badi = badiConfigFromEnv();

  cached = {
    provider,
    apiKey: provider === "efiskal" ? envValue("FISCAL_API_KEY") : null,
    endpoint:
      envValue("FISCAL_ENDPOINT") ??
      "https://efiskal.example.rs/api/v1/invoices",
    tin: envValue("FISCAL_TIN") ?? "000000000",
    locationId: envValue("FISCAL_LOCATION_ID") ?? "MAG-01",
    cashier: envValue("FISCAL_CASHIER") ?? "WEB",
    defaultVatLabel: envValue("FISCAL_VAT_LABEL") ?? "Δ",
    defaultInvoiceType: "NORMAL",
    baseUrl:
      process.env.NEXT_PUBLIC_BASE_URL ??
      process.env.NEXTAUTH_URL ??
      "https://www.svetpovoljnihcena.rs",
    badi: {
      ...badi,
      baseUrl:
        envValue("BADI_BASE_URL") ??
        BADI_BASE_URLS[badiEnv] ??
        BADI_BASE_URLS.sandbox!,
      taxRateLabel: envValue("BADI_TAX_RATE_LABEL") ?? "Ђ",
    },
  };
  return cached;
}

function badiConfigFromEnv(): Omit<BadiConfig, "baseUrl" | "taxRateLabel"> {
  const apiKey = envValue("BADI_API_KEY");
  const apiSecret = envValue("BADI_API_SECRET");
  const clientId = envValue("BADI_CLIENT_ID");
  const storeId = envValue("BADI_STORE_ID") ?? clientId;
  const cashierId = envValue("BADI_CASHIER_ID") ?? envValue("FISCAL_CASHIER");

  const pfx = envValue("BADI_VPFR_PFX");
  const password = envValue("BADI_VPFR_PASSWORD");
  const pac = envValue("BADI_VPFR_PAC");
  const suppliedVpfrValues = [pfx, password, pac].filter(Boolean).length;
  const modeValue = envValue("BADI_FISCAL_MODE")?.toLowerCase();
  if (modeValue && modeValue !== "public" && modeValue !== "vpfr") {
    throw new FiscalConfigError("BADI_FISCAL_MODE mora biti 'public' ili 'vpfr'.");
  }
  const fiscalMode: BadiConfig["fiscalMode"] =
    modeValue === "vpfr" || (!modeValue && suppliedVpfrValues > 0)
      ? "vpfr"
      : "public";

  if (fiscalMode === "public" && suppliedVpfrValues > 0) {
    throw new FiscalConfigError(
      "BADI VPFR podaci su postavljeni, ali je BADI_FISCAL_MODE='public'.",
    );
  }
  if (fiscalMode === "vpfr" && suppliedVpfrValues !== 3) {
    throw new FiscalConfigError(
      "BADI VPFR režim zahteva BADI_VPFR_PFX, BADI_VPFR_PASSWORD i BADI_VPFR_PAC.",
    );
  }

  const vpfr = pfx && password && pac
    ? {
        pfx: normalizePfxBase64(pfx),
        password,
        pac: normalizePac(pac),
      }
    : null;

  if (fiscalMode === "vpfr" && (!storeId || !cashierId)) {
    throw new FiscalConfigError(
      "BADI VPFR režim zahteva BADI_STORE_ID i BADI_CASHIER_ID (ili njihove postojeće fallback vrednosti).",
    );
  }

  return {
    apiKey,
    apiSecret,
    clientId,
    storeId,
    cashierId,
    fiscalMode,
    vpfr,
  };
}

function normalizePfxBase64(value: string): string {
  const compact = value.replace(/^data:[^,]+,/, "").replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(compact) || compact.length % 4 !== 0) {
    throw new FiscalConfigError("BADI_VPFR_PFX mora biti base64 sadržaj PFX/P12 datoteke.");
  }

  const decoded = Buffer.from(compact, "base64");
  if (decoded.length < 256 || decoded[0] !== 0x30) {
    throw new FiscalConfigError("BADI_VPFR_PFX ne izgleda kao PKCS#12 (PFX/P12) datoteka.");
  }
  return compact;
}

function normalizePac(value: string): string {
  const pac = value.toUpperCase();
  if (!/^[A-Z0-9]{6}$/.test(pac)) {
    throw new FiscalConfigError("BADI_VPFR_PAC mora imati tačno 6 alfanumeričkih znakova.");
  }
  return pac;
}

/** Test-only helper: reset the cached config so env changes take effect. */
export function __resetFiscalConfig() {
  cached = null;
}

export class FiscalConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FiscalConfigError";
  }
}
