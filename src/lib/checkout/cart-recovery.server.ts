import "server-only";

import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { getProductsBySkus } from "@/lib/api/catalog";
import {
  cartLineSchema,
  normalizeServerCartLines,
  type ServerCartLine,
} from "@/lib/api/cart";
import { getMediaVariantUrl } from "@/lib/media";
import { resolveProductPriceQuote } from "@/lib/pricing";
import { deliveryCategory } from "@/lib/delivery-tariff";
import { getEmailConfig } from "@/lib/email/config";
import { renderEmail } from "@/lib/email/render";
import { trackedDispatch, isEmailSuppressed } from "@/lib/email/tracking";
import { buildEmailUnsubscribeUrl } from "@/lib/email/unsubscribe";
import {
  CartRecoveryEmail,
  type CartRecoveryEmailItem,
} from "@/lib/email/templates/cart-recovery";
import {
  CART_RECOVERY_MAX_STEPS,
  cartRecoverySubject,
  isCartRecoveryEnabled,
  nextCartRecoverySendAt,
} from "./cart-recovery-policy";
import { buildCartRecoveryUrl } from "./cart-recovery-token";

const snapshotSchema = z.array(cartLineSchema).max(100);

export type DeliverCartRecoveryInput = {
  sessionId: string;
  step: number;
  activityAt: string;
};

export async function deliverCartRecoveryStep(
  input: DeliverCartRecoveryInput,
) {
  if (!isCartRecoveryEnabled()) return { sent: false, reason: "disabled" };
  const step = Math.trunc(input.step);
  if (step < 1 || step > CART_RECOVERY_MAX_STEPS) {
    return { sent: false, reason: "invalid_step" };
  }

  const session = await db.checkoutSession.findUnique({
    where: { id: input.sessionId },
    include: { user: { select: { email: true } } },
  });
  if (!session) return { sent: false, reason: "missing_session" };
  if (
    session.status !== "ACTIVE" ||
    session.orderId ||
    !session.recoveryConsent ||
    !session.recoveryConsentAt
  ) {
    return stopRecovery(session.id, "not_eligible");
  }
  if (session.lastActivityAt.toISOString() !== input.activityAt) {
    return { sent: false, reason: "stale_activity" };
  }
  if (session.recoveryStep >= step) {
    return { sent: false, reason: "already_sent" };
  }
  if (session.recoveryStep + 1 !== step) {
    return { sent: false, reason: "out_of_order" };
  }
  if (!session.recoveryNextSendAt || session.recoveryNextSendAt > new Date()) {
    return { sent: false, reason: "not_due" };
  }

  const recipient = (session.user?.email ?? session.guestEmail ?? "")
    .trim()
    .toLowerCase();
  if (!z.email().safeParse(recipient).success) {
    return stopRecovery(session.id, "missing_email");
  }
  if (await isEmailSuppressed(recipient)) {
    return stopRecovery(session.id, "provider_suppression");
  }

  const snapshot = parseCartRecoverySnapshot(session.cartSnapshot);
  const lines = await resolveRecoverableCartLines(snapshot, Boolean(session.userId));
  if (!lines.length) return stopRecovery(session.id, "empty_or_unavailable");

  const cartTotal = lines.reduce(
    (sum, line) => sum + line.unitPriceSale * line.qty,
    0,
  );
  const voucher =
    step === CART_RECOVERY_MAX_STEPS
      ? await ensureRecoveryVoucher(session.id, cartTotal)
      : null;
  const resumeUrl = buildCartRecoveryUrl(session.id, step);
  const unsubscribeUrl = buildEmailUnsubscribeUrl({
    purpose: "cart_recovery",
    sessionId: session.id,
    email: recipient,
    exp: Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60,
  });
  const items: CartRecoveryEmailItem[] = lines.map((line) => ({
    name: line.name,
    sku: line.sku,
    qty: line.qty,
    unitPrice: line.unitPriceSale,
  }));
  const { html, text } = await renderEmail(
    CartRecoveryEmail({
      step,
      items,
      cartTotal,
      resumeUrl,
      unsubscribeUrl,
      voucherCode: voucher?.code,
      discountPercent: voucher?.percent,
    }),
  );
  const subject = cartRecoverySubject(step, voucher?.percent ?? 0);
  const result = await trackedDispatch({
    kind: "abandoned_cart_recovery",
    from: getEmailConfig().marketingFrom,
    to: recipient,
    subject,
    html,
    text,
    tags: {
      kind: "abandoned_cart_recovery",
      recovery_step: String(step),
    },
    metadata: {
      checkoutSessionId: session.id,
      recoveryStep: step,
      itemCount: lines.reduce((sum, line) => sum + line.qty, 0),
      cartTotal,
      voucherCode: voucher?.code ?? null,
    },
    idempotencyKey: `cart-recovery-email:${session.id}:${step}`,
  });
  if (!result.ok) throw new Error(result.error);

  const sentAt = new Date();
  const updated = await db.checkoutSession.updateMany({
    where: {
      id: session.id,
      status: "ACTIVE",
      orderId: null,
      recoveryConsent: true,
      recoveryStep: step - 1,
      lastActivityAt: session.lastActivityAt,
    },
    data: {
      recoveryStep: step,
      recoveryLastSentAt: sentAt,
      recoveryNextSendAt: nextCartRecoverySendAt(sentAt, step),
      ...(step === CART_RECOVERY_MAX_STEPS
        ? {
            recoveryStoppedAt: sentAt,
            recoveryStopReason: "sequence_completed",
          }
        : {}),
    },
  });
  return {
    sent: true,
    step,
    recipient,
    stateUpdated: updated.count === 1,
  };
}

export function parseCartRecoverySnapshot(value: Prisma.JsonValue | null) {
  const parsed = snapshotSchema.safeParse(value);
  return parsed.success ? normalizeServerCartLines(parsed.data) : [];
}

export async function resolveRecoverableCartLines(
  snapshot: ServerCartLine[],
  loggedIn: boolean,
): Promise<ServerCartLine[]> {
  if (!snapshot.length) return [];
  const products = await getProductsBySkus(snapshot.map((line) => line.sku));
  const productsBySku = new Map(products.map((product) => [product.sku, product]));

  return snapshot.flatMap((line) => {
    const product = productsBySku.get(line.sku);
    if (!product) return [];
    const quote = resolveProductPriceQuote(product, { loggedIn });
    const dimensions = product.unitPackageDimensionsCm;
    return [
      {
        sku: product.sku,
        name: product.name,
        slug: product.slug,
        qty: line.qty,
        unitPriceFull: quote.full,
        unitPriceSale: quote.payable.effective,
        unitPriceLoyalty: quote.loyaltyOffer?.effective,
        loyaltyDiscountPct: quote.loyaltyOffer?.discountPct,
        thumbnailUrl:
          getMediaVariantUrl(product.media.images[0], "thumb") || undefined,
        variant: line.variant,
        familyCode: line.familyCode,
        withAssembly: line.withAssembly,
        assemblyPrice: line.assemblyPrice,
        ...(dimensions
          ? {
              deliveryCategory:
                deliveryCategory([dimensions.w, dimensions.d, dimensions.h]) ??
                undefined,
            }
          : {}),
      },
    ];
  });
}

async function stopRecovery(sessionId: string, reason: string) {
  const stoppedAt = new Date();
  await db.checkoutSession.updateMany({
    where: { id: sessionId, status: "ACTIVE" },
    data: {
      recoveryNextSendAt: null,
      recoveryStoppedAt: stoppedAt,
      recoveryStopReason: reason,
    },
  });
  return { sent: false, reason };
}

async function ensureRecoveryVoucher(sessionId: string, cartTotal: number) {
  const percent = boundedNumber(
    process.env.ABANDONED_CART_DISCOUNT_PERCENT,
    0,
    50,
    0,
  );
  const minimum = boundedNumber(
    process.env.ABANDONED_CART_DISCOUNT_MIN_SUBTOTAL,
    0,
    100_000_000,
    0,
  );
  if (percent <= 0 || cartTotal < minimum) return null;

  const code = cartRecoveryVoucherCode(sessionId);
  const now = new Date();
  const endsAt = new Date(now.getTime() + 48 * 60 * 60 * 1000);
  await db.voucher.upsert({
    where: { code },
    create: {
      code,
      kind: "PERCENT",
      amount: new Prisma.Decimal(percent),
      minSubtotal: minimum ? new Prisma.Decimal(minimum) : null,
      startsAt: now,
      endsAt,
      usageLimit: 1,
      perUserLimit: 1,
      active: true,
    },
    update: {},
  });
  return { code, percent };
}

export function cartRecoveryVoucherCode(sessionId: string) {
  return `VRATI-${createHash("sha256")
    .update(sessionId)
    .digest("hex")
    .slice(0, 10)
    .toUpperCase()}`;
}

export async function getActiveCartRecoveryVoucherCode(sessionId: string) {
  const voucher = await db.voucher.findUnique({
    where: { code: cartRecoveryVoucherCode(sessionId) },
    select: { code: true, active: true, startsAt: true, endsAt: true },
  });
  const now = new Date();
  return voucher?.active &&
    (!voucher.startsAt || voucher.startsAt <= now) &&
    (!voucher.endsAt || voucher.endsAt > now)
    ? voucher.code
    : null;
}

function boundedNumber(
  value: string | undefined,
  min: number,
  max: number,
  fallback: number,
) {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.min(Math.max(parsed, min), max)
    : fallback;
}
