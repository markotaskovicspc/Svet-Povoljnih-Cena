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
      apiKey: envValue("BADI_API_KEY"),
      apiSecret: envValue("BADI_API_SECRET"),
      baseUrl:
        envValue("BADI_BASE_URL") ??
        BADI_BASE_URLS[badiEnv] ??
        BADI_BASE_URLS.sandbox!,
      clientId: envValue("BADI_CLIENT_ID"),
      taxRateLabel: envValue("BADI_TAX_RATE_LABEL") ?? "Ђ",
      vpfr: badiVpfrFromEnv(),
    },
  };
  return cached;
}

function badiVpfrFromEnv(): BadiConfig["vpfr"] {
  const pfx = envValue("BADI_VPFR_PFX");
  const password = envValue("BADI_VPFR_PASSWORD");
  const pac = envValue("BADI_VPFR_PAC");
  return pfx && password && pac ? { pfx, password, pac } : null;
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
