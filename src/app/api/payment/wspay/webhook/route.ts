import { NextResponse } from "next/server";
import { Prisma, type PaymentStatus } from "@prisma/client";
import { db } from "@/lib/db";
import {
  parseReturnFields,
  verifyReturnSignature,
  WsPayConfigError,
} from "@/lib/wspay";
import { loadOrderForEmail, sendOrderStatusChanged } from "@/lib/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Phase 4B item 3 — async WSPay notification webhook.
 *
 * WSPay calls this URL server-to-server for events that happen outside the
 * browser session: settlement, voids, refunds, late 3-DS approvals, etc.
 *
 * The body uses the same field shape as the return URL, plus an optional
 * `Action` discriminator on newer integrations:
 *
 *   "Authorization"  → 3-DS auth completed
 *   "Settlement"     → funds captured
 *   "Refund"         → full refund
 *   "PartialRefund"  → partial refund
 *   "Void"           → authorization voided
 *
 * Signature verification is mandatory: an unsigned/forged POST is silently
 * rejected (200 to avoid retry storms is tempting, but we 401 so WSPay's
 * dashboard surfaces the misconfiguration during onboarding).
 */
export async function POST(req: Request) {
  const ct = req.headers.get("content-type") ?? "";
  let params: URLSearchParams;
  if (ct.includes("application/json")) {
    const json = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    params = new URLSearchParams();
    for (const [k, v] of Object.entries(json)) {
      if (v != null) params.set(k, String(v));
    }
  } else {
    params = new URLSearchParams(await req.text());
  }

  const fields = parseReturnFields(params);
  let valid = false;
  try {
    valid = verifyReturnSignature(fields);
  } catch (err) {
    if (err instanceof WsPayConfigError) {
      return NextResponse.json({ ok: false, error: "not_configured" }, { status: 503 });
    }
    throw err;
  }
  if (!valid) {
    return NextResponse.json({ ok: false, error: "invalid_signature" }, { status: 401 });
  }

  const number = fields.shoppingCartId;
  if (!number) {
    return NextResponse.json({ ok: false, error: "missing_cart_id" }, { status: 400 });
  }

  const order = await db.order.findUnique({
    where: { number },
    select: {
      id: true,
      total: true,
      payments: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { id: true, status: true },
      },
    },
  });
  if (!order) {
    return NextResponse.json({ ok: false, error: "unknown_order" }, { status: 404 });
  }

  const action = (params.get("Action") ?? "").toLowerCase();
  const newStatus: PaymentStatus = mapAction({ action, success: fields.success });

  let sideEffect: "potvrdjeno" | "vraceno" | null = null;
  await db.$transaction(async (tx) => {
    const existing = order.payments[0] ?? null;
    const raw = {
      action,
      success: fields.success,
      approvalCode: fields.approvalCode,
      errorMessage: fields.errorMessage,
    } satisfies Record<string, unknown> as Prisma.InputJsonValue;
    if (existing) {
      // Idempotent: skip when already in the target terminal state.
      if (existing.status === newStatus) return;
      await tx.payment.update({
        where: { id: existing.id },
        data: {
          status: newStatus,
          providerRef: fields.approvalCode || undefined,
          rawResponse: raw,
        },
      });
    } else {
      await tx.payment.create({
        data: {
          orderId: order.id,
          method: "KARTICA",
          status: newStatus,
          amount: new Prisma.Decimal(Number(order.total)),
          providerRef: fields.approvalCode || null,
          rawResponse: raw,
        },
      });
    }

    if (newStatus === "PAID") {
      await tx.order.update({
        where: { id: order.id },
        data: { status: "POTVRDJENO" },
      });
      await tx.orderStatusEvent.create({
        data: {
          orderId: order.id,
          status: "POTVRDJENO",
          note: `Plaćanje potvrđeno (WSPay async).`,
        },
      });
      sideEffect = "potvrdjeno";
    } else if (newStatus === "REFUNDED" || newStatus === "PARTIAL_REFUND") {
      await tx.orderStatusEvent.create({
        data: {
          orderId: order.id,
          status: "VRACENO",
          note:
            newStatus === "PARTIAL_REFUND"
              ? "Delimičan povraćaj sredstava."
              : "Povraćaj sredstava.",
        },
      });
      sideEffect = "vraceno";
    }
  });

  if (sideEffect) {
    void (async () => {
      try {
        const loaded = await loadOrderForEmail(order.id);
        if (loaded?.recipient) {
          await sendOrderStatusChanged({
            order: loaded.order,
            status: sideEffect!,
            to: loaded.recipient,
          });
        }
      } catch (err) {
        console.error("[email] order-status (wspay webhook) failed", err);
      }
    })();
  }

  return NextResponse.json({ ok: true });
}

function mapAction(args: { action: string; success: boolean }): PaymentStatus {
  if (!args.success) return "FAILED";
  switch (args.action) {
    case "refund":
      return "REFUNDED";
    case "partialrefund":
    case "partial_refund":
      return "PARTIAL_REFUND";
    case "void":
      return "FAILED";
    case "authorization":
      return "AUTHORIZED";
    case "settlement":
    case "":
    default:
      return "PAID";
  }
}
