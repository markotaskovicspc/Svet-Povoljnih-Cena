import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { num } from "@/lib/api/_helpers";
import {
  buildFormPayload,
  chargeWithToken,
  getWsPayConfig,
  renderAutoPostHtml,
  WsPayConfigError,
} from "@/lib/wspay";
import { rotateOrderAccessToken } from "@/lib/api/order-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Phase 4B item 1 — kicks off the WSPay payment for a given order.
 *
 * Resolution rules:
 *   - `orderId` may be either the DB cuid or the human number (`SPC-…`).
 *   - Order must use a card / wallet payment method.
 *   - If a Payment row is already PAID we redirect to the confirmation
 *     page with a notice instead of double-charging.
 *   - When the customer opted for "saved card" (signaled by a
 *     `savedCardDiscount` on the order), we charge the default token
 *     server-to-server and skip the redirect entirely.
 *
 * On success the browser is redirected to /checkout/potvrda. On any
 * misconfiguration we surface a small inline error page so the user can
 * pick another method instead of a blank crash.
 */
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
      status: true,
      userId: true,
      guestEmail: true,
      paymentMethod: true,
      savedCardDiscount: true,
      shipFirstName: true,
      shipLastName: true,
      shipPhone: true,
      shipStreet: true,
      shipCity: true,
      shipPostalCode: true,
      shipCountry: true,
      payments: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { id: true, status: true, method: true },
      },
    },
  });
  if (!order) return notFound();

  if (
    order.paymentMethod !== "KARTICA" &&
    order.paymentMethod !== "GOOGLE_PAY" &&
    order.paymentMethod !== "APPLE_PAY"
  ) {
    return errorPage(
      "Ova porudžbina ne koristi karticu kao način plaćanja.",
    );
  }

  const latestPayment = order.payments[0] ?? null;
  if (latestPayment?.status === "PAID") {
    const token = await rotateOrderAccessToken(order.id);
    return NextResponse.redirect(
      new URL(
        `/checkout/potvrda?order=${encodeURIComponent(order.number)}&token=${encodeURIComponent(
          token,
        )}&status=paid`,
        baseUrl(),
      ),
      { status: 303 },
    );
  }

  const customerEmail = order.userId
    ? (await db.user.findUnique({
        where: { id: order.userId },
        select: { email: true },
      }))?.email ?? null
    : order.guestEmail;

  // Saved-card flow: charge via token, no redirect.
  const savedCardDiscount = order.savedCardDiscount
    ? num(order.savedCardDiscount)
    : 0;
  if (savedCardDiscount > 0 && order.userId) {
    return await chargeViaSavedCard({
      orderId: order.id,
      orderNumber: order.number,
      total: num(order.total),
      userId: order.userId,
      paymentId: latestPayment?.id ?? null,
    });
  }

  // Hosted-form flow.
  let payload;
  try {
    payload = buildFormPayload({
      orderId: order.id,
      shoppingCartId: order.number,
      totalRsd: num(order.total),
      customer: {
        firstName: order.shipFirstName,
        lastName: order.shipLastName,
        email: customerEmail,
        phone: order.shipPhone,
        street: order.shipStreet,
        city: order.shipCity,
        postalCode: order.shipPostalCode,
        country: order.shipCountry,
      },
      requestToken: !!order.userId, // logged-in users get the option to save the card
    });
  } catch (err) {
    if (err instanceof WsPayConfigError) return errorPage(err.message);
    throw err;
  }

  await persistHostedStart({
    orderId: order.id,
    paymentId: latestPayment?.id ?? null,
    amount: num(order.total),
    rawRequest: payload.fields,
    redirectUrl: payload.action,
  });

  return new NextResponse(renderAutoPostHtml(payload), {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}

async function persistHostedStart(args: {
  orderId: string;
  paymentId: string | null;
  amount: number;
  rawRequest: Record<string, string>;
  redirectUrl: string;
}) {
  const data = {
    provider: "WSPAY" as const,
    status: "PENDING" as const,
    rawRequest: args.rawRequest as Prisma.InputJsonValue,
    redirectUrl: args.redirectUrl,
  };
  if (args.paymentId) {
    await db.payment.update({ where: { id: args.paymentId }, data });
    return;
  }
  await db.payment.create({
    data: {
      orderId: args.orderId,
      method: "KARTICA",
      amount: new Prisma.Decimal(args.amount),
      ...data,
    },
  });
}

async function chargeViaSavedCard(args: {
  orderId: string;
  orderNumber: string;
  total: number;
  userId: string;
  paymentId: string | null;
}): Promise<Response> {
  const card = await db.savedCard.findFirst({
    where: { userId: args.userId },
    orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
    select: { id: true, wsPayToken: true, holderName: true, last4: true },
  });
  if (!card) {
    return errorPage(
      "Nismo pronašli sačuvanu karticu. Pokušajte plaćanje preko WSPay forme.",
    );
  }

  let result;
  try {
    result = await chargeWithToken({
      shoppingCartId: args.orderNumber,
      totalRsd: args.total,
      token: card.wsPayToken,
      tokenName: card.holderName ?? `card-${card.last4}`,
    });
  } catch (err) {
    if (err instanceof WsPayConfigError) return errorPage(err.message);
    throw err;
  }

  await db.$transaction(async (tx) => {
    if (args.paymentId) {
      await tx.payment.update({
        where: { id: args.paymentId },
        data: {
          status: result.ok ? "PAID" : "FAILED",
          provider: "WSPAY",
          providerRef: result.providerRef,
          rawResponse: result.raw as Prisma.InputJsonValue,
          paidAt: result.ok ? new Date() : undefined,
        },
      });
    } else {
      await tx.payment.create({
        data: {
          orderId: args.orderId,
          method: "KARTICA",
          provider: "WSPAY",
          status: result.ok ? "PAID" : "FAILED",
          amount: new Prisma.Decimal(args.total),
          providerRef: result.providerRef,
          rawResponse: result.raw as Prisma.InputJsonValue,
          paidAt: result.ok ? new Date() : null,
        },
      });
    }
    if (result.ok) {
      await tx.order.update({
        where: { id: args.orderId },
        data: { status: "POTVRDJENO" },
      });
      await tx.orderStatusEvent.create({
        data: {
          orderId: args.orderId,
          status: "POTVRDJENO",
          note: "Plaćanje potvrđeno (sačuvana kartica).",
        },
      });
    }
  });

  const token = await rotateOrderAccessToken(args.orderId);
  const url = new URL("/checkout/potvrda", baseUrl());
  url.searchParams.set("order", args.orderNumber);
  url.searchParams.set("token", token);
  url.searchParams.set("status", result.ok ? "paid" : "failed");
  return NextResponse.redirect(url, { status: 303 });
}

function baseUrl(): string {
  try {
    return getWsPayConfig().publicBaseUrl;
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

function errorPage(message: string) {
  return new NextResponse(
    `<!doctype html><meta charset="utf-8"><title>Greška plaćanja</title>` +
      `<body style="font-family:system-ui;padding:40px;color:#1A1714;background:#FAF7F2">` +
      `<h1 style="font-family:Georgia,serif">Plaćanje trenutno nije moguće</h1>` +
      `<p>${escape(message)}</p>` +
      `<p><a href="/korpa">Nazad na korpu</a></p></body>`,
    {
      status: 503,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    },
  );
}

function escape(s: string): string {
  return s.replace(/[&<>"]/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&quot;",
  );
}
