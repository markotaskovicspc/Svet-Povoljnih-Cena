import { NextResponse } from "next/server";
import { Prisma, type PaymentMethod, type PaymentStatus } from "@prisma/client";
import { db } from "@/lib/db";
import {
  parseReturnFields,
  verifyReturnSignature,
  WsPayConfigError,
  getWsPayConfig,
  type WsPayReturnFields,
} from "@/lib/wspay";
import { loadOrderForEmail, sendOrderStatusChanged } from "@/lib/email";
import { issueAndDeliverFiscalReceipt } from "@/lib/fiscal";
import { rotateOrderAccessToken } from "@/lib/api/order-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Phase 4B item 2 — WSPay return URL handler.
 *
 * WSPay redirects the browser back here after the cardholder completes
 * (or cancels) the payment. We:
 *
 *   1. Parse + signature-verify the return fields (success or failure).
 *   2. Update the latest Payment row + Order status.
 *   3. If WSPay handed us a tokenization response and the order has a
 *      logged-in user, persist a SavedCard so future checkouts can use
 *      the +5% saved-card discount.
 *   4. Redirect the user back to /checkout/potvrda with a status flag.
 *
 * The async webhook (`/api/payment/wspay/webhook`) re-runs the same
 * persistence path; both routes are idempotent — re-applying the same
 * `Success` + `ApprovalCode` for the same order is a no-op after the
 * first write.
 */
export async function GET(req: Request) {
  return handle(new URL(req.url).searchParams);
}

export async function POST(req: Request) {
  // WSPay can also POST the return params on some flows.
  const ct = req.headers.get("content-type") ?? "";
  let params: URLSearchParams;
  if (ct.includes("application/x-www-form-urlencoded")) {
    params = new URLSearchParams(await req.text());
    // Append `result` from query string (we set it on the outgoing form).
    const u = new URL(req.url).searchParams;
    if (!params.has("result") && u.get("result")) {
      params.set("result", u.get("result")!);
    }
    if (!params.has("orderId") && u.get("orderId")) {
      params.set("orderId", u.get("orderId")!);
    }
  } else {
    params = new URL(req.url).searchParams;
  }
  return handle(params);
}

async function handle(params: URLSearchParams) {
  const fields = parseReturnFields(params);
  const orderId = fields.orderId;
  if (!orderId) {
    return await redirectFinal({
      number: null,
      status: "error",
      message: "Nepoznata porudžbina.",
    });
  }

  const order = await db.order.findFirst({
    where: { OR: [{ id: orderId }, { number: orderId }] },
    select: {
      id: true,
      number: true,
      userId: true,
      total: true,
      paymentMethod: true,
      payments: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { id: true, status: true },
      },
    },
  });
  if (!order) {
    return await redirectFinal({
      number: null,
      status: "error",
      message: "Porudžbina nije pronađena.",
    });
  }

  // Cancel: WSPay redirects without a signature; bounce back without changes.
  if (fields.result === "cancel") {
    return await redirectFinal({ number: order.number, status: "cancel" });
  }

  // Every other result (success / error) MUST carry a verified signature.
  let signatureValid = false;
  try {
    signatureValid = verifyReturnSignature(fields);
  } catch (err) {
    if (err instanceof WsPayConfigError) {
      return await redirectFinal({
        number: order.number,
        status: "error",
        message: err.message,
      });
    }
    throw err;
  }
  if (!signatureValid) {
    return await redirectFinal({
      number: order.number,
      status: "error",
      message: "Neispravna potvrda banke.",
    });
  }

  await applyPaymentResult({
    orderId: order.id,
    paymentId: order.payments[0]?.id ?? null,
    amount: Number(order.total),
    paymentMethod: order.paymentMethod,
    fields,
  });

  if (fields.success && order.userId && fields.token && fields.tokenName) {
    await persistTokenAsSavedCard({ userId: order.userId, fields });
  }

  return await redirectFinal({
    number: order.number,
    status: fields.success ? "paid" : "failed",
    message: fields.success ? null : fields.errorMessage,
  });
}

export async function applyPaymentResult(args: {
  orderId: string;
  paymentId: string | null;
  amount: number;
  paymentMethod: PaymentMethod;
  fields: WsPayReturnFields;
}) {
  const { orderId, paymentId, amount, paymentMethod, fields } = args;
  const status: PaymentStatus = fields.success ? "PAID" : "FAILED";
  const raw = serializeFields(fields);

  let didConfirm = false;
  await db.$transaction(async (tx) => {
    const existing = paymentId
      ? await tx.payment.findUnique({ where: { id: paymentId } })
      : null;
    if (existing?.status === "PAID") return; // idempotent; never regress a paid payment

    if (existing) {
      await tx.payment.update({
        where: { id: existing.id },
        data: {
          status,
          provider: "WSPAY",
          providerRef: fields.approvalCode || existing.providerRef,
          rawResponse: raw,
          paidAt: fields.success ? new Date() : undefined,
        },
      });
    } else {
      await tx.payment.create({
        data: {
          orderId,
          method: paymentMethod,
          provider: "WSPAY",
          status,
          amount: new Prisma.Decimal(amount),
          providerRef: fields.approvalCode || null,
          rawResponse: raw,
          paidAt: fields.success ? new Date() : null,
        },
      });
    }

    if (fields.success) {
      await tx.order.update({
        where: { id: orderId },
        data: { status: "POTVRDJENO" },
      });
      await tx.orderStatusEvent.create({
        data: {
          orderId,
          status: "POTVRDJENO",
          note: `Plaćanje potvrđeno (WSPay #${fields.approvalCode}).`,
        },
      });
      didConfirm = true;
      // Phase 4F (eFiskal) hooks fire from here once that module lands —
      // keep this function the single trigger point so we don't scatter
      // side-effects.
    }
  });

  if (didConfirm) {
    void (async () => {
      try {
        const loaded = await loadOrderForEmail(orderId);
        if (loaded?.recipient) {
          await sendOrderStatusChanged({
            order: loaded.order,
            status: "potvrdjeno",
            to: loaded.recipient,
          });
        }
        await issueAndDeliverFiscalReceipt(orderId, {
          source: "AUTO_ADVANCE",
          paymentMethod,
        });
      } catch (err) {
        console.error("[payment] WSPay return side-effect failed", err);
      }
    })();
  }
}

async function persistTokenAsSavedCard(args: {
  userId: string;
  fields: WsPayReturnFields;
}) {
  const { userId, fields } = args;
  if (!fields.token || !fields.tokenName) return;
  const existing = await db.savedCard.findUnique({
    where: { wsPayToken: fields.token },
    select: { id: true },
  });
  if (existing) return;
  const isFirst = (await db.savedCard.count({ where: { userId } })) === 0;
  await db.savedCard.create({
    data: {
      userId,
      brand: normalizeBrand(fields.cardBrand),
      last4: fields.cardLast4 ?? "0000",
      expMonth: fields.expiryMonth ?? 12,
      expYear: fields.expiryYear ?? new Date().getFullYear() + 3,
      holderName: fields.tokenName,
      wsPayToken: fields.token,
      isDefault: isFirst,
    },
  });
}

function normalizeBrand(raw: string | null): string {
  const b = (raw ?? "").toLowerCase();
  if (b.includes("visa")) return "visa";
  if (b.includes("master")) return "master";
  if (b.includes("dina")) return "dina";
  if (b.includes("amex") || b.includes("american")) return "amex";
  return b || "card";
}

function serializeFields(fields: WsPayReturnFields): Prisma.InputJsonValue {
  return {
    success: fields.success,
    approvalCode: fields.approvalCode,
    shoppingCartId: fields.shoppingCartId,
    totalAmount: fields.totalAmount,
    cardBrand: fields.cardBrand,
    cardLast4: fields.cardLast4,
    errorMessage: fields.errorMessage,
  } satisfies Record<string, unknown> as Prisma.InputJsonValue;
}

async function redirectFinal(args: {
  number: string | null;
  status: "paid" | "failed" | "cancel" | "error";
  message?: string | null;
}) {
  const base = (() => {
    try {
      return getWsPayConfig().publicBaseUrl;
    } catch {
      return process.env.NEXTAUTH_URL ?? "http://localhost:3000";
    }
  })();
  const target =
    args.status === "error" || !args.number
      ? new URL("/korpa", base)
      : new URL(`/checkout/potvrda`, base);
  if (args.number) {
    target.searchParams.set("order", args.number);
    const token = await rotateOrderAccessToken(args.number).catch((err) => {
      console.error("[order-access] WSPay return token rotation failed", err);
      return null;
    });
    if (token) target.searchParams.set("token", token);
  }
  target.searchParams.set("status", args.status);
  if (args.message) target.searchParams.set("err", args.message);
  return NextResponse.redirect(target, { status: 303 });
}
