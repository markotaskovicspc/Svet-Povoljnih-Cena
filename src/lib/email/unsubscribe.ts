import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { getEmailConfig } from "./config";

export type EmailUnsubscribePayload =
  | {
      purpose: "newsletter";
      email: string;
      exp?: number;
    }
  | {
      purpose: "marketing";
      userId: string;
      email?: string;
      exp?: number;
    }
  | {
      purpose: "cart_recovery";
      sessionId: string;
      email: string;
      exp?: number;
    }
  | {
      purpose: "alert";
      userId: string;
      productId: string;
      alert: "back_in_stock" | "on_sale";
      exp?: number;
    };

export type VerifiedEmailUnsubscribePayload = EmailUnsubscribePayload & {
  exp?: number;
};

export function buildEmailUnsubscribeToken(payload: EmailUnsubscribePayload) {
  const secret = getUnsubscribeSecret();
  if (!secret) throw new Error("EMAIL_UNSUBSCRIBE_SECRET is not configured");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function buildEmailUnsubscribeUrl(payload: EmailUnsubscribePayload) {
  const cfg = getEmailConfig();
  return `${cfg.baseUrl}/api/email/unsubscribe/${buildEmailUnsubscribeToken(payload)}`;
}

export function verifyEmailUnsubscribeToken(
  token: string,
): VerifiedEmailUnsubscribePayload | null {
  const secret = getUnsubscribeSecret();
  if (!secret) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;

  const expected = createHmac("sha256", secret).update(body).digest("base64url");
  if (!safeEqual(sig, expected)) return null;

  try {
    const parsed = JSON.parse(
      Buffer.from(body, "base64url").toString("utf8"),
    ) as VerifiedEmailUnsubscribePayload;
    if (parsed.exp && parsed.exp < Math.floor(Date.now() / 1000)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function applyEmailUnsubscribe(payload: EmailUnsubscribePayload) {
  if (payload.purpose === "newsletter") {
    const email = payload.email.trim().toLowerCase();
    const { withdrawMarketingEmail } = await import("@/lib/newsletter/contacts");
    await withdrawMarketingEmail(email, "email-link");
    return { ok: true as const, email, kind: "newsletter" as const };
  }

  if (payload.purpose === "marketing") {
    const user = await db.user.findUnique({
      where: { id: payload.userId },
      select: { email: true },
    });
    await db.marketingConsent.upsert({
      where: { userId: payload.userId },
      create: { userId: payload.userId, email: false },
      update: { email: false },
    });
    const email = (payload.email ?? user?.email ?? "").trim().toLowerCase();
    if (email) {
      const { withdrawMarketingEmail } = await import("@/lib/newsletter/contacts");
      await withdrawMarketingEmail(email, "account-email-link");
    }
    return { ok: true as const, email: email || null, kind: "marketing" as const };
  }

  if (payload.purpose === "cart_recovery") {
    const session = await db.checkoutSession.findUnique({
      where: { id: payload.sessionId },
      select: {
        userId: true,
        guestEmail: true,
        user: { select: { email: true } },
      },
    });
    const email = (session?.user?.email ?? session?.guestEmail ?? "")
      .trim()
      .toLowerCase();
    if (!session || !email || email !== payload.email.trim().toLowerCase()) {
      return {
        ok: true as const,
        email: payload.email.trim().toLowerCase(),
        kind: "cart_recovery" as const,
        changed: 0,
        userId: null,
      };
    }
    const stoppedAt = new Date();
    const changed = await db.checkoutSession.updateMany({
      where: session.userId
        ? { userId: session.userId, status: "ACTIVE" }
        : {
            guestEmail: { equals: email, mode: "insensitive" },
            status: "ACTIVE",
          },
      data: {
        recoveryConsent: false,
        recoveryConsentAt: null,
        recoveryNextSendAt: null,
        recoveryStoppedAt: stoppedAt,
        recoveryStopReason: "unsubscribed",
      },
    });
    return {
      ok: true as const,
      email,
      kind: "cart_recovery" as const,
      changed: changed.count,
      userId: session.userId,
    };
  }

  const data =
    payload.alert === "back_in_stock"
      ? await db.$transaction([
          db.backInStockAlert.deleteMany({
            where: { userId: payload.userId, productId: payload.productId },
          }),
          db.wishlistItem.updateMany({
            where: { userId: payload.userId, productId: payload.productId },
            data: { notifyOnRestock: false },
          }),
        ])
      : await db.$transaction([
          db.onSaleAlert.deleteMany({
            where: { userId: payload.userId, productId: payload.productId },
          }),
          db.wishlistItem.updateMany({
            where: { userId: payload.userId, productId: payload.productId },
            data: { notifyOnSale: false },
          }),
        ]);
  return {
    ok: true as const,
    email: null,
    kind: "alert" as const,
    changed: data[0].count,
  };
}

function getUnsubscribeSecret() {
  return getEmailConfig().unsubscribeSecret;
}

function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
