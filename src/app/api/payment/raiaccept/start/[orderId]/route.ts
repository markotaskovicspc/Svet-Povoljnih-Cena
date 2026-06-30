import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { num } from "@/lib/api/_helpers";
import {
  canAccessOrder,
  readOrderAccessToken,
  rotateOrderAccessToken,
} from "@/lib/api/order-access";
import {
  getRaiAcceptPublicBaseUrl,
  isRaiAcceptMethod,
  RaiAcceptConfigError,
  requireRaiAcceptConfigured,
} from "@/lib/payments/raiaccept";
import { logOperationalError } from "@/lib/monitoring";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ orderId: string }> },
) {
  const { orderId } = await ctx.params;
  const order = await db.order.findFirst({
    where: { OR: [{ id: orderId }, { number: orderId }] },
    select: {
      id: true,
      number: true,
      total: true,
      userId: true,
      publicAccessTokenHash: true,
      paymentMethod: true,
      payments: {
        where: { provider: "RAIFFEISEN_CARD" },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { id: true, status: true },
      },
    },
  });
  if (!order) return notFound();

  if (
    !(await canAccessOrder({
      order,
      token: readOrderAccessToken(req),
    }))
  ) {
    return errorPage("Link za plaćanje nije važeći.", 403);
  }

  if (!isRaiAcceptMethod(order.paymentMethod)) {
    return errorPage("Ova porudžbina ne koristi karticu kao način plaćanja.", 400);
  }

  const latestPayment = order.payments[0] ?? null;
  if (latestPayment?.status === "PAID") {
    const token = await rotateOrderAccessToken(order.id);
    const url = new URL("/checkout/potvrda", getRaiAcceptPublicBaseUrl());
    url.searchParams.set("order", order.number);
    url.searchParams.set("token", token);
    url.searchParams.set("status", "paid");
    return NextResponse.redirect(url, { status: 303 });
  }

  await persistRaiAcceptStart({
    orderId: order.id,
    paymentId: latestPayment?.id ?? null,
    amount: num(order.total),
    method: order.paymentMethod,
  });

  try {
    requireRaiAcceptConfigured();
  } catch (err) {
    if (err instanceof RaiAcceptConfigError) {
      logOperationalError("payment.raiaccept.start_not_configured", err, {
        orderId: order.id,
        orderNumber: order.number,
      });
      return errorPage(err.message, 503);
    }
    throw err;
  }
}

async function persistRaiAcceptStart(args: {
  orderId: string;
  paymentId: string | null;
  amount: number;
  method: "KARTICA" | "GOOGLE_PAY" | "APPLE_PAY";
}) {
  const data = {
    provider: "RAIFFEISEN_CARD" as const,
    status: "PENDING" as const,
    rawRequest: {
      provider: "RAIACCEPT",
      status: "configuration_pending",
    } satisfies Record<string, unknown> as Prisma.InputJsonValue,
  };
  if (args.paymentId) {
    await db.payment.update({ where: { id: args.paymentId }, data });
    return;
  }
  await db.payment.create({
    data: {
      orderId: args.orderId,
      method: args.method,
      amount: new Prisma.Decimal(args.amount),
      ...data,
    },
  });
}

function notFound() {
  return new NextResponse("Porudžbina nije pronađena.", {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

function errorPage(message: string, status = 503) {
  return new NextResponse(
    `<!doctype html><meta charset="utf-8"><title>RaiAccept plaćanje</title>` +
      `<body style="font-family:system-ui;padding:40px;color:#1A1714;background:#FAF7F2">` +
      `<h1 style="font-family:Georgia,serif">Kartično plaćanje trenutno nije moguće</h1>` +
      `<p>${escapeHtml(message)}</p>` +
      `<p><a href="/korpa">Nazad na korpu</a></p></body>`,
    {
      status,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Robots-Tag": "noindex",
      },
    },
  );
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&quot;",
  );
}
