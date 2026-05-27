import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { num } from "@/lib/api/_helpers";
import {
  ipsPaymentProvider,
  getIpsConfig,
  IpsConfigError,
  IpsGatewayError,
} from "@/lib/payments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ orderId: string }> },
) {
  const { orderId } = await ctx.params;
  const order = await db.order.findFirst({
    where: { OR: [{ id: orderId }, { number: orderId }] },
    select: {
      id: true,
      number: true,
      total: true,
      paymentMethod: true,
      payments: {
        where: { provider: "IPS" },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { id: true, status: true },
      },
    },
  });
  if (!order) return notFound();
  if (order.paymentMethod !== "IPS") {
    return errorPage("Ova porudžbina ne koristi IPS kao način plaćanja.", 400);
  }

  const base = baseUrl();
  const latestPayment = order.payments[0] ?? null;
  if (latestPayment?.status === "PAID") {
    return NextResponse.redirect(
      new URL(`/checkout/potvrda?order=${encodeURIComponent(order.number)}&status=paid`, base),
      { status: 303 },
    );
  }

  let result;
  try {
    result = await ipsPaymentProvider.createPayment(
      order.number,
      num(order.total),
      order.paymentMethod,
    );
  } catch (err) {
    if (err instanceof IpsConfigError || err instanceof IpsGatewayError) {
      return errorPage(err.message, err instanceof IpsGatewayError ? 502 : 503);
    }
    throw err;
  }

  const data = {
    provider: "IPS" as const,
    status: "PENDING" as const,
    providerRef: result.providerRef,
    paymentReference: result.paymentReference,
    redirectUrl: result.redirectUrl,
    rawRequest: result.rawRequest as Prisma.InputJsonValue,
    rawResponse: result.rawResponse as Prisma.InputJsonValue,
    expiresAt: result.expiresAt,
  };
  if (latestPayment) {
    await db.payment.update({ where: { id: latestPayment.id }, data });
  } else {
    await db.payment.create({
      data: {
        orderId: order.id,
        method: "IPS",
        amount: order.total,
        ...data,
      },
    });
  }

  return NextResponse.redirect(result.redirectUrl!, { status: 303 });
}

function baseUrl() {
  try {
    return getIpsConfig().publicBaseUrl;
  } catch {
    return process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  }
}

function notFound() {
  return new NextResponse("Porudžbina nije pronađena.", {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

function errorPage(message: string, status = 503) {
  return new NextResponse(
    `<!doctype html><meta charset="utf-8"><title>IPS plaćanje</title>` +
      `<body style="font-family:system-ui;padding:40px;color:#1A1714;background:#FAF7F2">` +
      `<h1 style="font-family:Georgia,serif">IPS plaćanje trenutno nije moguće</h1>` +
      `<p>${escapeHtml(message)}</p>` +
      `<p><a href="/korpa">Nazad na korpu</a></p></body>`,
    {
      status,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    },
  );
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&quot;",
  );
}
