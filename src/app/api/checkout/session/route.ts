import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import {
  checkRateLimitForRequest,
  rateLimitJson,
  RATE_LIMITS,
} from "@/lib/security/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const sessionIdSchema = z
  .string()
  .min(12)
  .max(80)
  .regex(/^[A-Za-z0-9_-]+$/);

const paymentMethodMap = {
  ips: "IPS",
  kartica: "KARTICA",
  google_pay: "GOOGLE_PAY",
  apple_pay: "APPLE_PAY",
  uplata_na_racun: "UPLATA_NA_RACUN",
  pouzece_gotovina: "POUZECE_GOTOVINA",
  pouzece_kartica: "POUZECE_KARTICA",
} as const;

const shippingMethodMap = {
  kurir: "KURIR",
  kamion: "KAMION",
} as const;

const bodySchema = z.object({
  sessionId: sessionIdSchema,
  status: z.enum(["ACTIVE", "CONVERTED", "ABANDONED"]).default("ACTIVE"),
  step: z.enum(["identity", "shipping", "method", "payment", "review"]),
  identity: z.enum(["guest", "login", "register"]).optional().nullable(),
  guestEmail: z.email().optional().nullable(),
  shippingCity: z.string().trim().max(80).optional().nullable(),
  shippingMethod: z.enum(["kurir", "kamion"]).optional().nullable(),
  paymentMethod: z
    .enum([
      "ips",
      "kartica",
      "google_pay",
      "apple_pay",
      "uplata_na_racun",
      "pouzece_gotovina",
      "pouzece_kartica",
    ])
    .optional()
    .nullable(),
  lineCount: z.int().min(0).max(99).default(0),
  itemQty: z.int().min(0).max(999).default(0),
  cartTotal: z.number().min(0).max(99_999_999).default(0),
});

export async function POST(req: Request) {
  const limited = await checkRateLimitForRequest(
    req,
    "checkout-session",
    RATE_LIMITS.checkout,
  );
  if (!limited.ok) {
    return rateLimitJson(limited);
  }
  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: { code: "INVALID", issues: parsed.error.flatten() } },
      { status: 400 },
    );
  }

  const input = parsed.data;
  const user = await getCurrentUser();
  const userId = user?.userType === "customer" ? user.id : null;

  await db.checkoutSession.upsert({
    where: { id: input.sessionId },
    create: {
      id: input.sessionId,
      userId,
      guestEmail: userId ? null : input.guestEmail ?? null,
      identity: input.identity ?? null,
      step: input.step,
      status: input.status,
      lineCount: input.lineCount,
      itemQty: input.itemQty,
      cartTotal: new Prisma.Decimal(input.cartTotal),
      shippingCity: input.shippingCity || null,
      shippingMethod: input.shippingMethod
        ? shippingMethodMap[input.shippingMethod]
        : null,
      paymentMethod: input.paymentMethod
        ? paymentMethodMap[input.paymentMethod]
        : null,
    },
    update: {
      userId,
      guestEmail: userId ? null : input.guestEmail ?? null,
      identity: input.identity ?? null,
      step: input.step,
      status: input.status,
      lineCount: input.lineCount,
      itemQty: input.itemQty,
      cartTotal: new Prisma.Decimal(input.cartTotal),
      shippingCity: input.shippingCity || null,
      shippingMethod: input.shippingMethod
        ? shippingMethodMap[input.shippingMethod]
        : null,
      paymentMethod: input.paymentMethod
        ? paymentMethodMap[input.paymentMethod]
        : null,
    },
  });

  return NextResponse.json({ ok: true });
}
