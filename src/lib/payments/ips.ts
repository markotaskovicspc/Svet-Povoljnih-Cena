import "server-only";

import { randomUUID } from "node:crypto";
import { envValue } from "@/lib/env";
import { Prisma, type PaymentMethod } from "@prisma/client";
import { db } from "@/lib/db";
import { num } from "@/lib/api/_helpers";
import { enqueueBackgroundJob } from "@/lib/background-jobs";
import type {
  CreatePaymentResult,
  PaymentProviderAdapter,
  PaymentStatusResult,
  RefundPaymentResult,
} from "./types";

export class IpsConfigError extends Error {}
export class IpsGatewayError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly raw: unknown,
  ) {
    super(message);
  }
}

interface IpsConfig {
  baseUrl: string;
  userId: string;
  tid: string;
  publicBaseUrl: string;
  successUrl: string;
  failUrl: string;
  cancelUrl: string;
  callbackUrl: string;
}

interface IpsToken {
  value: string;
  expiresAt: number;
}

interface IpsCallbackPayload {
  tid: string;
  amount: string;
  orderId: string;
  responseCode: string;
  paymentReference?: string;
}

let cachedToken: IpsToken | null = null;

export const ipsPaymentProvider: PaymentProviderAdapter = {
  createPayment,
  handleCallback,
  checkPaymentStatus,
  refundPayment,
};

export function getIpsConfig(): IpsConfig {
  const baseUrl = envValue("IPS_BASE_URL")?.replace(/\/$/, "");
  const userId = envValue("IPS_USER_ID");
  const tid = envValue("IPS_TID");
  const publicBaseUrl = (
    process.env.IPS_PUBLIC_BASE_URL ??
    process.env.NEXT_PUBLIC_BASE_URL ??
    process.env.NEXTAUTH_URL ??
    ""
  ).replace(/\/$/, "");

  if (!baseUrl || !userId || !tid || !publicBaseUrl) {
    throw new IpsConfigError(
      "IPS nije konfigurisan (IPS_BASE_URL / IPS_USER_ID / IPS_TID / IPS_PUBLIC_BASE_URL).",
    );
  }

  // Presence alone isn't enough: placeholder values (e.g. an unfilled
  // `GET_FROM_...`) pass the truthy check above but then blow up later inside
  // `fetch()`/`new URL()` with a raw `ERR_INVALID_URL` TypeError that the route
  // handler doesn't recognize as an IPS error (→ uncaught 500). Validate the
  // URLs here so misconfigured values fail the same graceful way missing ones do.
  if (!isValidHttpUrl(baseUrl)) {
    throw new IpsConfigError(`IPS_BASE_URL nije ispravan URL: ${baseUrl}`);
  }
  if (!isValidHttpUrl(publicBaseUrl)) {
    throw new IpsConfigError(`IPS_PUBLIC_BASE_URL nije ispravan URL: ${publicBaseUrl}`);
  }

  return {
    baseUrl,
    userId,
    tid,
    publicBaseUrl,
    successUrl: process.env.IPS_SUCCESS_URL ?? `${publicBaseUrl}/api/payment/ips/return?result=success`,
    failUrl: process.env.IPS_FAIL_URL ?? `${publicBaseUrl}/api/payment/ips/return?result=fail`,
    cancelUrl: process.env.IPS_CANCEL_URL ?? `${publicBaseUrl}/api/payment/ips/return?result=cancel`,
    callbackUrl: process.env.IPS_CALLBACK_URL ?? `${publicBaseUrl}/api/payment/ips/callback`,
  };
}

function isValidHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function formatIpsAmount(amount: number | Prisma.Decimal): string {
  const n = typeof amount === "number" ? amount : amount.toNumber();
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error("IPS iznos mora biti pozitivan broj.");
  }
  return n.toFixed(2);
}

async function createPayment(
  orderId: string,
  amount: number,
  method: PaymentMethod,
): Promise<CreatePaymentResult> {
  if (method !== "IPS") throw new Error("IPS provider podržava samo IPS plaćanje.");
  const cfg = getIpsConfig();
  const amountText = formatIpsAmount(amount);
  const urls = returnUrlsForOrder(cfg, orderId);
  const rawRequest = {
    tid: cfg.tid,
    amount: amountText,
    orderId,
    successSiteURL: urls.success,
    failSiteURL: urls.fail,
    cancelSiteURL: urls.cancel,
    callbackURL: cfg.callbackUrl,
  };
  const rawResponse = await authedPostJson<Record<string, unknown>>(
    cfg,
    "/ips/v2/eCommerce",
    rawRequest,
  );
  const redirectUrl =
    typeof rawResponse.qrCodeURL === "string" ? rawResponse.qrCodeURL : null;
  if (!redirectUrl) {
    throw new IpsGatewayError("IPS odgovor ne sadrži QR/deep-link URL.", 502, rawResponse);
  }

  return {
    provider: "IPS",
    providerRef: redirectUrl,
    paymentReference: null,
    redirectUrl,
    rawRequest,
    rawResponse,
    expiresAt: cachedToken ? new Date(cachedToken.expiresAt) : null,
  };
}

async function handleCallback(providerPayload: unknown): Promise<PaymentStatusResult> {
  const payload = parseIpsPayload(providerPayload);
  const result = await applyIpsResult(payload);
  return result;
}

async function checkPaymentStatus(orderId: string): Promise<PaymentStatusResult> {
  const order = await db.order.findFirst({
    where: { OR: [{ id: orderId }, { number: orderId }] },
    select: { id: true, number: true, total: true },
  });
  if (!order) throw new Error(`Porudžbina ${orderId} ne postoji.`);

  const cfg = getIpsConfig();
  const rawRequest = {
    tid: cfg.tid,
    amount: formatIpsAmount(num(order.total)),
    orderId: order.number,
  };
  const rawResponse = await authedPostJson<Record<string, unknown>>(
    cfg,
    "/ips/v2/checkStatus",
    rawRequest,
  );
  const payload = parseIpsPayload({
    ...rawResponse,
    tid: rawRequest.tid,
    amount: rawRequest.amount,
    orderId: rawRequest.orderId,
  });
  return applyIpsResult(payload, rawRequest, rawResponse);
}

async function refundPayment(
  orderId: string,
  amount: number,
  options: { idempotencyKey?: string; actorId?: string; fiscalDocumentId?: string } = {},
): Promise<RefundPaymentResult> {
  const order = await db.order.findFirst({
    where: { OR: [{ id: orderId }, { number: orderId }] },
    select: {
      id: true,
      number: true,
      status: true,
      fiscalDocuments: {
        where: { kind: "SALE", status: "ISSUED" },
        take: 1,
        select: { id: true },
      },
    },
  });
  if (!order) throw new Error(`Porudžbina ${orderId} ne postoji.`);

  if (order.fiscalDocuments.length > 0) {
    if (!options.fiscalDocumentId) {
      throw new Error(
        "Porudžbina je fiskalizovana. Povraćaj mora biti pokrenut kroz fiskalnu refundaciju.",
      );
    }
    const fiscalRefund = await db.fiscalDocument.findFirst({
      where: {
        id: options.fiscalDocumentId,
        orderId: order.id,
        kind: "REFUND",
        status: "ISSUED",
      },
      select: { id: true },
    });
    if (!fiscalRefund) {
      throw new Error("IPS povraćaj nije povezan sa izdatom fiskalnom refundacijom.");
    }
  }

  const cfg = getIpsConfig();
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("IPS iznos za povraćaj nije ispravan.");
  }
  const idempotencyKey = (options.idempotencyKey ?? `ips-refund:${randomUUID()}`).slice(0, 200);
  const existing = await db.paymentRefund.findUnique({ where: { idempotencyKey } });
  if (existing) {
    if (existing.status === "COMPLETED" || existing.status === "FAILED") {
      return {
        refundId: existing.id,
        refunded: existing.status === "COMPLETED",
        responseCode: existing.providerRef ?? "",
        rawRequest: (existing.rawRequest ?? {}) as Record<string, unknown>,
        rawResponse: existing.rawResponse ?? {},
      };
    }
    throw new Error("IPS povraćaj sa ovim ključem čeka obradu ili ručnu proveru.");
  }

  const reservation = await db.$transaction(async (tx) => {
    const payment = await tx.payment.findFirst({
      where: { orderId: order.id, provider: "IPS" },
      orderBy: { createdAt: "desc" },
      select: { id: true, amount: true, status: true },
    });
    if (!payment || !["PAID", "PARTIAL_REFUND"].includes(payment.status)) {
      throw new Error("IPS povraćaj je moguć samo za potvrđenu uplatu.");
    }
    const reserved = await tx.paymentRefund.aggregate({
      where: {
        orderId: order.id,
        method: "IPS",
        status: { in: ["PENDING", "COMPLETED", "NEEDS_REVIEW"] },
      },
      _sum: { amount: true },
    });
    const remaining = num(payment.amount) - num(reserved._sum.amount ?? 0);
    if (amount > remaining + 0.0001) {
      throw new Error(`IPS povraćaj premašuje preostali iznos (${remaining.toFixed(2)} RSD).`);
    }
    const refund = await tx.paymentRefund.create({
      data: {
        orderId: order.id,
        fiscalDocumentId: options.fiscalDocumentId ?? null,
        idempotencyKey,
        method: "IPS",
        provider: "IPS",
        status: "PENDING",
        amount: new Prisma.Decimal(amount),
        actorId: options.actorId ?? null,
      },
      select: { id: true },
    });
    return { refundId: refund.id, paymentId: payment.id, paymentAmount: num(payment.amount) };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  const rawRequest = {
    tid: cfg.tid,
    amount: formatIpsAmount(amount),
    orderId: order.number,
  };
  await db.paymentRefund.update({
    where: { id: reservation.refundId },
    data: { rawRequest: rawRequest as Prisma.InputJsonValue },
  });

  let rawResponse: Record<string, unknown>;
  try {
    rawResponse = await authedPostJson<Record<string, unknown>>(
      cfg,
      "/ips/v2/refund",
      rawRequest,
      { retryOn401: false },
    );
  } catch (error) {
    await db.paymentRefund.update({
      where: { id: reservation.refundId },
      data: {
        status: "NEEDS_REVIEW",
        error: error instanceof Error ? error.message.slice(0, 1000) : "ambiguous_gateway_error",
      },
    });
    throw error;
  }
  const responseCode = String(rawResponse.responseCode ?? "");
  const refunded = responseCode === "00";

  if (refunded) {
    await db.$transaction(async (tx) => {
      await tx.paymentRefund.update({
        where: { id: reservation.refundId },
        data: {
          status: "COMPLETED",
          providerRef: responseCode,
          rawResponse: rawResponse as Prisma.InputJsonValue,
          completedAt: new Date(),
          error: null,
        },
      });
      const completed = await tx.paymentRefund.aggregate({
        where: { orderId: order.id, method: "IPS", status: "COMPLETED" },
        _sum: { amount: true },
      });
      const refundStatus = num(completed._sum.amount ?? 0) >= reservation.paymentAmount
        ? "REFUNDED"
        : "PARTIAL_REFUND";
      await tx.payment.update({
        where: { id: reservation.paymentId },
        data: {
          status: refundStatus,
          rawRequest: rawRequest as Prisma.InputJsonValue,
          rawResponse: rawResponse as Prisma.InputJsonValue,
        },
      });
      if (refundStatus === "REFUNDED") {
        await tx.order.update({
          where: { id: order.id },
          data: { status: "VRACENO" },
        });
      }
      await tx.orderStatusEvent.create({
        data: {
          orderId: order.id,
          status: refundStatus === "REFUNDED" ? "VRACENO" : order.status,
          note:
            refundStatus === "PARTIAL_REFUND"
              ? `Delimičan povraćaj sredstava izvršen preko IPS sistema (${rawRequest.amount} RSD).`
              : "Povraćaj sredstava izvršen preko IPS sistema.",
        },
      });
    });
  } else {
    await db.paymentRefund.update({
      where: { id: reservation.refundId },
      data: {
        status: "FAILED",
        providerRef: responseCode,
        rawResponse: rawResponse as Prisma.InputJsonValue,
        error: `IPS response code ${responseCode || "missing"}`,
      },
    });
  }

  return {
    refundId: reservation.refundId,
    refunded,
    responseCode,
    rawRequest,
    rawResponse,
  };
}

async function getSessionToken(cfg: IpsConfig): Promise<IpsToken> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt - now > 60_000) return cachedToken;

  const raw = await postJson<Record<string, unknown>>(cfg, "/res/v1/generateToken", {
    userId: cfg.userId,
    tid: cfg.tid,
  });
  const value = typeof raw.sessionToken === "string" ? raw.sessionToken : null;
  if (!value) throw new IpsGatewayError("IPS token nije vraćen.", 502, raw);

  // The spec's tokenExpiryTime unit is ambiguous ("4n", default 1h), so we can't
  // trust its magnitude. Fall back to 1h when absent/invalid, then clamp the
  // computed lifetime to a sane window so a wildly small/large value can't make
  // us re-auth on every call or hold a stale token for days.
  // The live test PGW misspells the field as "tokenExpiriyTime" (observed
  // 2026-07-10), so accept both spellings.
  const seconds = Number(raw.tokenExpiryTime ?? raw.tokenExpiriyTime);
  const lifetimeSeconds = Number.isFinite(seconds) && seconds > 0 ? seconds : 3600;
  const clampedSeconds = Math.min(Math.max(lifetimeSeconds, 60), 24 * 3600);
  cachedToken = {
    value,
    expiresAt: now + clampedSeconds * 1000,
  };
  return cachedToken;
}

function clearCachedToken() {
  cachedToken = null;
}

// Token-authenticated POST used by all gateway calls. If the gateway rejects the
// token (401), the cached token is stale/revoked: clear it and retry exactly once
// with a freshly minted one before giving up. Callers that can't prove a 401 is
// pre-execution (refunds) must pass retryOn401: false — a blind retry there
// risks firing the same refund twice.
async function authedPostJson<T>(
  cfg: IpsConfig,
  path: string,
  body: Record<string, unknown>,
  opts: { retryOn401: boolean } = { retryOn401: true },
): Promise<T> {
  const token = await getSessionToken(cfg);
  try {
    return await postJson<T>(cfg, path, body, token);
  } catch (err) {
    if (opts.retryOn401 && err instanceof IpsGatewayError && err.status === 401) {
      clearCachedToken();
      const fresh = await getSessionToken(cfg);
      return await postJson<T>(cfg, path, body, fresh);
    }
    throw err;
  }
}

async function postJson<T>(
  cfg: IpsConfig,
  path: string,
  body: Record<string, unknown>,
  token?: IpsToken,
): Promise<T> {
  const res = await fetch(`${cfg.baseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token.value}` } : {}),
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  let raw: unknown = null;
  try {
    raw = await res.json();
  } catch {
    raw = { httpStatus: res.status };
  }
  if (!res.ok) {
    throw new IpsGatewayError(`IPS zahtev nije uspeo (${res.status}).`, res.status, raw);
  }
  return raw as T;
}

function returnUrlsForOrder(cfg: IpsConfig, orderNumber: string) {
  const withOrder = (value: string) => {
    const url = new URL(value);
    url.searchParams.set("order", orderNumber);
    return url.toString();
  };
  return {
    success: withOrder(cfg.successUrl),
    fail: withOrder(cfg.failUrl),
    cancel: withOrder(cfg.cancelUrl),
  };
}

function parseIpsPayload(raw: unknown): IpsCallbackPayload {
  const payload = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const cfg = getIpsConfig();
  const parsed = {
    tid: String(payload.tid ?? ""),
    amount: String(payload.amount ?? ""),
    orderId: String(payload.orderId ?? ""),
    responseCode: String(payload.responseCode ?? ""),
    paymentReference:
      payload.paymentReference == null ? undefined : String(payload.paymentReference),
  };

  if (parsed.tid !== cfg.tid) throw new Error("IPS TID se ne poklapa.");
  if (!parsed.orderId) throw new Error("IPS payload nema orderId.");
  if (!parsed.amount) throw new Error("IPS payload nema amount.");
  if (!parsed.responseCode) throw new Error("IPS payload nema responseCode.");
  return parsed;
}

async function applyIpsResult(
  payload: IpsCallbackPayload,
  rawRequest?: Record<string, unknown>,
  rawResponse?: unknown,
): Promise<PaymentStatusResult> {
  const order = await db.order.findUnique({
    where: { number: payload.orderId },
    select: {
      id: true,
      number: true,
      total: true,
      payments: {
        where: { provider: "IPS" },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { id: true, status: true, providerRef: true },
      },
    },
  });
  if (!order) throw new Error(`IPS porudžbina ${payload.orderId} ne postoji.`);

  const expectedAmount = formatIpsAmount(num(order.total));
  if (payload.amount !== expectedAmount) {
    throw new Error(`IPS iznos se ne poklapa: ${payload.amount} != ${expectedAmount}.`);
  }

  const paid = payload.responseCode === "00";
  const raw = (rawResponse ?? payload) as Prisma.InputJsonValue;
  const request = (rawRequest ?? {
    tid: payload.tid,
    amount: payload.amount,
    orderId: payload.orderId,
  }) as Prisma.InputJsonValue;
  let didConfirm = false;

  // Payten has given us no enumerated terminal-decline code table, so a non-"00"
  // response is NOT proof the payment has failed — it may just mean "not yet
  // paid", and this whole call can be forged (the callback route calls us with
  // an unauthenticated tid/orderId/amount, and checkStatus can be probed too).
  // Writing FAILED here would pull the order out of expirePendingPayments'
  // PENDING-only match (src/lib/payments/expiry.ts) and permanently strand its
  // reserved stock. So: on paid, confirm as usual; otherwise only refresh audit
  // fields and leave the payment PENDING — expiry.ts is what times it out and
  // restores stock.
  await db.$transaction(async (tx) => {
    const existing = order.payments[0] ?? null;
    if (existing?.status === "PAID") return;

    if (existing) {
      if (paid) {
        const updated = await tx.payment.updateMany({
          where: { id: existing.id, status: { not: "PAID" } },
          data: {
            status: "PAID",
            providerRef: payload.paymentReference ?? undefined,
            paymentReference: payload.paymentReference ?? undefined,
            rawRequest: request,
            rawResponse: raw,
            paidAt: new Date(),
          },
        });
        // Concurrent caller (callback + return-URL checkStatus) already won the
        // race and confirmed this payment — don't double-fire side effects.
        if (updated.count !== 1) return;
      } else {
        await tx.payment.update({
          where: { id: existing.id },
          data: {
            rawRequest: request,
            rawResponse: raw,
          },
        });
      }
    } else if (paid) {
      await tx.payment.create({
        data: {
          orderId: order.id,
          method: "IPS",
          provider: "IPS",
          status: "PAID",
          amount: new Prisma.Decimal(payload.amount),
          providerRef: payload.paymentReference ?? null,
          paymentReference: payload.paymentReference ?? null,
          rawRequest: request,
          rawResponse: raw,
          paidAt: new Date(),
        },
      });
    }
    // No existing payment and not paid: nothing to persist — the start route is
    // the only creator of PENDING IPS payments, so there's no PENDING row to
    // touch and no FAILED status to invent.

    if (paid) {
      await tx.order.update({
        where: { id: order.id },
        data: { status: "POTVRDJENO" },
      });
      await tx.orderStatusEvent.create({
        data: {
          orderId: order.id,
          status: "POTVRDJENO",
          note: `Plaćanje potvrđeno (IPS ${payload.paymentReference ?? payload.responseCode}).`,
        },
      });
      didConfirm = true;
    }
  });

  if (didConfirm) {
    await Promise.all([
      enqueueBackgroundJob({
        kind: "IPS_PAYMENT_EMAIL",
        payload: { orderId: order.id },
        idempotencyKey: `ips-payment-email:${order.id}`,
      }),
      enqueueBackgroundJob({
        kind: "FISCAL_RECEIPT",
        payload: { orderId: order.id, source: "AUTO_ADVANCE", paymentMethod: "IPS" },
        idempotencyKey: `fiscal-advance:${order.id}`,
      }),
    ]);
  }

  return {
    paid,
    responseCode: payload.responseCode,
    providerRef: payload.paymentReference ?? null,
    paymentReference: payload.paymentReference ?? null,
    rawRequest: rawRequest ?? {
      tid: payload.tid,
      amount: payload.amount,
      orderId: payload.orderId,
    },
    rawResponse: rawResponse ?? payload,
  };
}
