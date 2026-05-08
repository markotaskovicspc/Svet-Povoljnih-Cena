import "server-only";

/**
 * Phase 4F — Elektronski fiskalni račun configuration.
 *
 * Provider is selected via `FISCAL_PROVIDER`:
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

export type FiscalProvider = "efiskal" | "none";

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
}

let cached: FiscalConfig | null = null;

export function getFiscalConfig(): FiscalConfig {
  if (cached) return cached;
  const raw = (process.env.FISCAL_PROVIDER ?? "none").toLowerCase();
  const provider: FiscalProvider = raw === "efiskal" ? "efiskal" : "none";

  cached = {
    provider,
    apiKey: provider === "efiskal" ? process.env.FISCAL_API_KEY ?? null : null,
    endpoint:
      process.env.FISCAL_ENDPOINT ??
      "https://efiskal.example.rs/api/v1/invoices",
    tin: process.env.FISCAL_TIN ?? "000000000",
    locationId: process.env.FISCAL_LOCATION_ID ?? "MAG-01",
    cashier: process.env.FISCAL_CASHIER ?? "WEB",
    defaultVatLabel: process.env.FISCAL_VAT_LABEL ?? "Δ",
    defaultInvoiceType: "NORMAL",
    baseUrl:
      process.env.NEXT_PUBLIC_BASE_URL ??
      process.env.NEXTAUTH_URL ??
      "https://www.svetpovoljnihcena.rs",
  };
  return cached;
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
