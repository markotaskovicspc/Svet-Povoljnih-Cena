import "server-only";

import { Prisma, type PaymentMethod } from "@prisma/client";
import { db } from "@/lib/db";
import { num } from "@/lib/api/_helpers";
import { loadOrderForEmail, sendOrderStatusChanged } from "@/lib/email";
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
  const baseUrl = process.env.IPS_BASE_URL?.replace(/\/$/, "");
  const userId = process.env.IPS_USER_ID;
  const tid = process.env.IPS_TID;
  const publicBaseUrl = (
    process.env.IPS_PUBLIC_BASE_URL ??
    process.env.NEXTAUTH_URL ??
    process.env.WSPAY_PUBLIC_BASE_URL ??
    ""
  ).replace(/\/$/, "");

  if (!baseUrl || !userId || !tid || !publicBaseUrl) {
    throw new IpsConfigError(
      "IPS nije konfigurisan (IPS_BASE_URL / IPS_USER_ID / IPS_TID / IPS_PUBLIC_BASE_URL).",
    );
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
  const token = await getSessionToken(cfg);
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
  const rawResponse = await postJson<Record<string, unknown>>(
    cfg,
    "/ips/v2/eCommerce",
    rawRequest,
    token,
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
    expiresAt: token.expiresAt ? new Date(token.expiresAt) : null,
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
  const token = await getSessionToken(cfg);
  const rawRequest = {
    tid: cfg.tid,
    amount: formatIpsAmount(num(order.total)),
    orderId: order.number,
  };
  const rawResponse = await postJson<Record<string, unknown>>(
    cfg,
    "/ips/v2/checkStatus",
    rawRequest,
    token,
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
): Promise<RefundPaymentResult> {
  const order = await db.order.findFirst({
    where: { OR: [{ id: orderId }, { number: orderId }] },
    select: { id: true, number: true },
  });
  if (!order) throw new Error(`Porudžbina ${orderId} ne postoji.`);

  const cfg = getIpsConfig();
  const token = await getSessionToken(cfg);
  const rawRequest = {
    tid: cfg.tid,
    amount: formatIpsAmount(amount),
    orderId: order.number,
  };
  const rawResponse = await postJson<Record<string, unknown>>(
    cfg,
    "/ips/v2/refund",
    rawRequest,
    token,
  );
  const responseCode = String(rawResponse.responseCode ?? "");
  const refunded = responseCode === "00";

  if (refunded) {
    await db.$transaction(async (tx) => {
      const payment = await tx.payment.findFirst({
        where: { orderId: order.id, provider: "IPS" },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      if (payment) {
        await tx.payment.update({
          where: { id: payment.id },
          data: {
            status: "REFUNDED",
            rawRequest: rawRequest as Prisma.InputJsonValue,
            rawResponse: rawResponse as Prisma.InputJsonValue,
          },
        });
      }
      await tx.orderStatusEvent.create({
        data: {
          orderId: order.id,
          status: "VRACENO",
          note: "Povraćaj sredstava izvršen preko IPS sistema.",
        },
      });
    });
  }

  return {
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

  const seconds = Number(raw.tokenExpiryTime);
  cachedToken = {
    value,
    expiresAt: now + (Number.isFinite(seconds) && seconds > 0 ? seconds : 3600) * 1000,
  };
  return cachedToken;
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
  const status = paid ? "PAID" : "FAILED";
  const raw = (rawResponse ?? payload) as Prisma.InputJsonValue;
  const request = (rawRequest ?? {
    tid: payload.tid,
    amount: payload.amount,
    orderId: payload.orderId,
  }) as Prisma.InputJsonValue;
  let didConfirm = false;

  await db.$transaction(async (tx) => {
    const existing = order.payments[0] ?? null;
    if (existing?.status === "PAID") return;

    if (existing) {
      await tx.payment.update({
        where: { id: existing.id },
        data: {
          status,
          paymentReference: payload.paymentReference ?? undefined,
          rawRequest: request,
          rawResponse: raw,
          paidAt: paid ? new Date() : undefined,
        },
      });
    } else {
      await tx.payment.create({
        data: {
          orderId: order.id,
          method: "IPS",
          provider: "IPS",
          status,
          amount: new Prisma.Decimal(payload.amount),
          providerRef: payload.paymentReference ?? null,
          paymentReference: payload.paymentReference ?? null,
          rawRequest: request,
          rawResponse: raw,
          paidAt: paid ? new Date() : null,
        },
      });
    }

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
    void (async () => {
      try {
        const loaded = await loadOrderForEmail(order.id);
        if (loaded?.recipient) {
          await sendOrderStatusChanged({
            order: loaded.order,
            status: "potvrdjeno",
            to: loaded.recipient,
          });
        }
      } catch (err) {
        console.error("[email] order-status (ips) failed", err);
      }
    })();
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
