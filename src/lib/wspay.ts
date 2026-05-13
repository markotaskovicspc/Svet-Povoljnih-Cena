import "server-only";

import { createHash } from "node:crypto";

/**
 * Phase 4B — WSPay (cards + Apple/Google Pay).
 *
 * WSPay is the Adriatic-region acquirer used by Svet Akcija. The
 * customer pays on a hosted form (no PAN ever touches our infra) and is
 * redirected back with a signed result. This module covers:
 *
 *   1. Form-post payload construction + request signature.
 *   2. Return URL signature verification.
 *   3. Async webhook (status notification) signature verification.
 *   4. Server-to-server tokenized authorization for "saved card" charges.
 *
 * Signature rules (per WSPay integration guide v2.x — SHA-512 hex, lowercase):
 *
 *   request:        SHA512(ShopID + Secret + ShoppingCartID + Secret + TotalAmount + Secret)
 *   return/webhook: SHA512(ShopID + Secret + ShoppingCartID + Secret + Success + Secret + ApprovalCode + Secret)
 *
 * `TotalAmount` is formatted with a comma decimal separator (e.g. "12345,67").
 *
 * The PAN-less token flow (auth-with-token) is documented at
 * https://www.wspay.info/dev/ — `Authorization-Token` endpoint accepts a
 * JSON body and returns `Success` (1/0), `ApprovalCode`, `ErrorMessage`.
 */

export interface WsPayConfig {
  shopId: string;
  secret: string;
  formUrl: string;
  /** Server-to-server REST base used for tokenized charges. */
  apiBase: string;
  lang: "SR" | "HR" | "EN";
  /** Absolute base for return / cancel / error redirects. */
  publicBaseUrl: string;
}

export class WsPayConfigError extends Error {}

/**
 * Read WSPay config from the environment. Throws when any required value is
 * missing — callers should treat the error as "WSPay not configured" and
 * fall back to the placeholder UX (Phase 2 confirmation page).
 */
export function getWsPayConfig(): WsPayConfig {
  const shopId = process.env.WSPAY_SHOP_ID;
  const secret = process.env.WSPAY_SECRET;
  const publicBaseUrl =
    process.env.WSPAY_PUBLIC_BASE_URL ?? process.env.NEXTAUTH_URL ?? null;
  if (!shopId || !secret || !publicBaseUrl) {
    throw new WsPayConfigError(
      "WSPay nije konfigurisan (WSPAY_SHOP_ID / WSPAY_SECRET / WSPAY_PUBLIC_BASE_URL).",
    );
  }
  const useProd = process.env.WSPAY_ENV === "production";
  return {
    shopId,
    secret,
    formUrl:
      process.env.WSPAY_FORM_URL ??
      (useProd
        ? "https://form.wspay.biz/authorization.aspx"
        : "https://formtest.wspay.biz/authorization.aspx"),
    apiBase:
      process.env.WSPAY_API_BASE ??
      (useProd
        ? "https://secure.wspay.biz/api"
        : "https://test.wspay.biz/api"),
    lang: (process.env.WSPAY_LANG as WsPayConfig["lang"] | undefined) ?? "SR",
    publicBaseUrl: publicBaseUrl.replace(/\/$/, ""),
  };
}

/** Format an RSD amount with comma decimal separator (no thousand grouping). */
export function formatAmount(amount: number): string {
  return amount.toFixed(2).replace(".", ",");
}

function sha512Hex(input: string): string {
  return createHash("sha512").update(input, "utf8").digest("hex");
}

/** Request signature embedded in the form POST. */
export function signRequest(args: {
  shopId: string;
  secret: string;
  shoppingCartId: string;
  totalAmount: string;
}): string {
  const { shopId, secret, shoppingCartId, totalAmount } = args;
  return sha512Hex(
    shopId + secret + shoppingCartId + secret + totalAmount + secret,
  );
}

/** Return / webhook signature. `success` is "1" on approval, "0" otherwise. */
export function signReturn(args: {
  shopId: string;
  secret: string;
  shoppingCartId: string;
  success: string;
  approvalCode: string;
}): string {
  const { shopId, secret, shoppingCartId, success, approvalCode } = args;
  return sha512Hex(
    shopId +
      secret +
      shoppingCartId +
      secret +
      success +
      secret +
      approvalCode +
      secret,
  );
}

export interface BuildFormInput {
  /** Order DB id — used to identify the order on return without leaking the human number. */
  orderId: string;
  /** Human order number (also used as ShoppingCartID for the bank statement). */
  shoppingCartId: string;
  totalRsd: number;
  customer: {
    firstName: string;
    lastName: string;
    email?: string | null;
    phone?: string | null;
    street?: string | null;
    city?: string | null;
    postalCode?: string | null;
    country?: string;
  };
  /** When true, ask WSPay to issue a Token for "save card" UX. */
  requestToken?: boolean;
}

export interface FormPostPayload {
  action: string;
  fields: Record<string, string>;
}

/**
 * Build the auto-submitting form payload that the customer's browser POSTs
 * to WSPay. Returns the action URL and a flat fields map ready to render
 * as `<input type="hidden" name=... value=... />`.
 */
export function buildFormPayload(input: BuildFormInput): FormPostPayload {
  const cfg = getWsPayConfig();
  const totalAmount = formatAmount(input.totalRsd);
  const signature = signRequest({
    shopId: cfg.shopId,
    secret: cfg.secret,
    shoppingCartId: input.shoppingCartId,
    totalAmount,
  });

  const ret = (path: string) =>
    `${cfg.publicBaseUrl}/api/payment/wspay/return?orderId=${encodeURIComponent(
      input.orderId,
    )}&result=${path}`;

  const fields: Record<string, string> = {
    ShopID: cfg.shopId,
    ShoppingCartID: input.shoppingCartId,
    TotalAmount: totalAmount,
    Signature: signature,
    ReturnURL: ret("success"),
    ReturnErrorURL: ret("error"),
    CancelURL: ret("cancel"),
    Lang: cfg.lang,
    PaymentPlan: "0001",
    CustomerFirstName: input.customer.firstName,
    CustomerLastName: input.customer.lastName,
    CustomerEmail: input.customer.email ?? "",
    CustomerPhone: input.customer.phone ?? "",
    CustomerAddress: input.customer.street ?? "",
    CustomerCity: input.customer.city ?? "",
    CustomerZIP: input.customer.postalCode ?? "",
    CustomerCountry: input.customer.country ?? "RS",
  };
  if (input.requestToken) fields.IsTokenRequest = "1";

  return { action: cfg.formUrl, fields };
}

/**
 * Render the form payload as an HTML page that auto-submits to WSPay.
 * The hidden `<noscript>` button keeps the flow accessible if JS is off.
 */
export function renderAutoPostHtml(payload: FormPostPayload): string {
  const inputs = Object.entries(payload.fields)
    .map(
      ([name, value]) =>
        `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(
          value,
        )}" />`,
    )
    .join("");
  return `<!doctype html>
<html lang="sr">
<head>
  <meta charset="utf-8" />
  <title>Preusmeravanje na WSPay…</title>
  <meta name="robots" content="noindex" />
  <style>
    body{font-family:system-ui,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;background:#FAF7F2;color:#1A1714;margin:0}
    .card{padding:24px 28px;border-radius:16px;background:#fff;box-shadow:0 8px 32px rgba(0,0,0,.08);max-width:360px;text-align:center}
    button{margin-top:16px;padding:10px 18px;border:0;border-radius:999px;background:#1A1714;color:#fff;font-weight:500;cursor:pointer}
  </style>
</head>
<body>
  <div class="card">
    <p>Preusmeravamo vas na sigurnu WSPay stranu…</p>
    <form id="wspay" method="POST" action="${escapeHtml(payload.action)}">
      ${inputs}
      <noscript><button type="submit">Nastavi na WSPay</button></noscript>
    </form>
  </div>
  <script>document.getElementById('wspay').submit();</script>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ──────────────────────────────────────────────────────────────────────
// Return / webhook parsing
// ──────────────────────────────────────────────────────────────────────

export interface WsPayReturnFields {
  /** Our DB order id we passed via `orderId` query. */
  orderId: string | null;
  shoppingCartId: string | null;
  success: boolean;
  approvalCode: string;
  totalAmount: string | null;
  signature: string | null;
  errorMessage: string | null;
  /** Card data returned for the receipt. */
  cardBrand: string | null;
  cardLast4: string | null;
  expiryMonth: number | null;
  expiryYear: number | null;
  /** Tokenization response (only when IsTokenRequest=1 was sent). */
  token: string | null;
  tokenName: string | null;
  /** "success" | "cancel" | "error" — from our own routing query, used by ReturnURL handler. */
  result: "success" | "cancel" | "error" | null;
}

/** Read either querystring (return URL) or x-www-form-urlencoded body (webhook). */
export function parseReturnFields(
  source: URLSearchParams | Record<string, unknown>,
): WsPayReturnFields {
  const get = (key: string): string | null => {
    if (source instanceof URLSearchParams) return source.get(key);
    const v = source[key];
    return typeof v === "string" ? v : v == null ? null : String(v);
  };
  const successRaw = get("Success") ?? "0";
  const expM = Number(get("ExpirationMonth"));
  const expY = Number(get("ExpirationYear"));
  const result = get("result");
  return {
    orderId: get("orderId"),
    shoppingCartId: get("ShoppingCartID"),
    success: successRaw === "1",
    approvalCode: get("ApprovalCode") ?? "",
    totalAmount: get("Amount") ?? get("TotalAmount"),
    signature: get("Signature"),
    errorMessage: get("ErrorMessage"),
    cardBrand: get("CardBrand") ?? get("PaymentType"),
    cardLast4: get("MaskedPan")?.slice(-4) ?? get("CCNumber")?.slice(-4) ?? null,
    expiryMonth: Number.isFinite(expM) && expM > 0 ? expM : null,
    expiryYear: Number.isFinite(expY) && expY > 0 ? expY : null,
    token: get("Token"),
    tokenName: get("TokenName"),
    result:
      result === "success" || result === "cancel" || result === "error"
        ? result
        : null,
  };
}

/**
 * Validate the return signature against the configured secret. Returns
 * `true` only when WSPay's signature matches what we recompute locally.
 *
 * For successful payments WSPay always returns `Signature`; for cancels
 * the signature may be omitted (no approval code) — callers should treat
 * a missing signature as not-yet-paid rather than an attack.
 */
export function verifyReturnSignature(fields: WsPayReturnFields): boolean {
  if (!fields.signature || !fields.shoppingCartId) return false;
  const cfg = getWsPayConfig();
  const expected = signReturn({
    shopId: cfg.shopId,
    secret: cfg.secret,
    shoppingCartId: fields.shoppingCartId,
    success: fields.success ? "1" : "0",
    approvalCode: fields.approvalCode,
  });
  return timingSafeEqualHex(expected, fields.signature);
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ──────────────────────────────────────────────────────────────────────
// Tokenized server-to-server charge ("saved card" flow)
// ──────────────────────────────────────────────────────────────────────

export interface TokenChargeInput {
  shoppingCartId: string;
  totalRsd: number;
  token: string;
  tokenName: string;
}

export interface TokenChargeResult {
  ok: boolean;
  approvalCode: string;
  providerRef: string | null;
  errorMessage: string | null;
  raw: unknown;
}

/**
 * Charge a previously tokenized card without browser redirect. Used when the
 * customer chose "saved card" at checkout (gets the +5% discount per spec
 * section 3D / pricing engine).
 *
 * The endpoint and payload follow the WSPay REST `Authorization-Token`
 * contract; if WSPay flips the schema the only adjustments needed live in
 * this function.
 */
export async function chargeWithToken(
  input: TokenChargeInput,
): Promise<TokenChargeResult> {
  const cfg = getWsPayConfig();
  const totalAmount = formatAmount(input.totalRsd);
  const signature = signRequest({
    shopId: cfg.shopId,
    secret: cfg.secret,
    shoppingCartId: input.shoppingCartId,
    totalAmount,
  });

  const body = {
    Version: "2.0",
    WsPayShopID: cfg.shopId,
    ShoppingCartID: input.shoppingCartId,
    TotalAmount: totalAmount,
    Signature: signature,
    Token: input.token,
    TokenName: input.tokenName,
  };

  const res = await fetch(`${cfg.apiBase}/services/process.asmx/Authorize-Token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  let raw: unknown = null;
  try {
    raw = await res.json();
  } catch {
    raw = { httpStatus: res.status };
  }

  const json = (raw ?? {}) as Record<string, unknown>;
  const successField = json.Success ?? json.success;
  const approvalCode = String(json.ApprovalCode ?? json.approvalCode ?? "");
  const stan = json.STAN ?? json.stan;
  const errorMessage =
    typeof json.ErrorMessage === "string"
      ? json.ErrorMessage
      : typeof json.errorMessage === "string"
        ? json.errorMessage
        : null;
  const ok =
    res.ok &&
    (successField === 1 || successField === "1" || successField === true) &&
    approvalCode.length > 0;

  return {
    ok,
    approvalCode,
    providerRef: stan ? String(stan) : approvalCode || null,
    errorMessage: ok ? null : errorMessage,
    raw,
  };
}
