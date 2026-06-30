import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { num } from "@/lib/api/_helpers";

/**
 * Voucher validation (Phase 3C — item 3 of checkout flow / item 7 of plan).
 *
 * Returns the discount amount in RSD (always positive). Stacking & first-buyer
 * 5% / saved-card 5% interactions live in the pricing engine (Phase 3D); this
 * function is concerned only with whether the code itself is valid for this
 * `(userId, subtotal, now)` triple.
 */

export type VoucherResult =
  | {
      ok: true;
      code: string;
      label: string;
      /** Effective discount in RSD applied to subtotal. */
      discountRsd: number;
      kind: "percent" | "fixed";
    }
  | {
      ok: false;
      reason: string;
    };

export async function validateVoucher(
  rawCode: string,
  subtotal: number,
  userId: string | null,
): Promise<VoucherResult> {
  const code = rawCode.trim().toUpperCase();
  if (!code) return { ok: false, reason: "Unesite kod" };

  const v = await db.voucher.findUnique({
    where: { code },
    include: { redemptions: { select: { userId: true } } },
  });
  if (!v || !v.active) return { ok: false, reason: "Kod nije pronađen ili je istekao" };

  const now = new Date();
  if (v.startsAt && v.startsAt > now) return { ok: false, reason: "Vaučer još nije aktivan" };
  if (v.endsAt && v.endsAt < now) return { ok: false, reason: "Vaučer je istekao" };

  if (v.minSubtotal && subtotal < num(v.minSubtotal)) {
    return {
      ok: false,
      reason: `Vaučer važi za porudžbine preko ${num(v.minSubtotal).toLocaleString("sr-Latn-RS")} RSD`,
    };
  }

  if (v.usageLimit && v.redemptions.length >= v.usageLimit) {
    return { ok: false, reason: "Vaučer je iskorišćen" };
  }

  if (v.perUserLimit && userId) {
    const used = v.redemptions.filter((r) => r.userId === userId).length;
    if (used >= v.perUserLimit) {
      return { ok: false, reason: "Već ste iskoristili ovaj vaučer" };
    }
  }

  const amount = num(v.amount);
  const isPercent = v.kind === "PERCENT";
  const discountRsd = isPercent
    ? Math.round((subtotal * amount) / 100)
    : Math.min(amount, subtotal);

  const label = isPercent
    ? `−${amount}%`
    : `−${amount.toLocaleString("sr-Latn-RS")} RSD`;

  return {
    ok: true,
    code: v.code,
    label,
    discountRsd,
    kind: isPercent ? "percent" : "fixed",
  };
}

type LockedVoucherRow = {
  code: string;
  kind: "PERCENT" | "FIXED";
  amount: Prisma.Decimal;
  minSubtotal: Prisma.Decimal | null;
  startsAt: Date | null;
  endsAt: Date | null;
  usageLimit: number | null;
  perUserLimit: number | null;
  active: boolean;
};

export async function validateVoucherForCheckout(
  tx: Prisma.TransactionClient,
  rawCode: string,
  subtotal: number,
  userId: string | null,
): Promise<VoucherResult> {
  const code = rawCode.trim().toUpperCase();
  if (!code) return { ok: false, reason: "Unesite kod" };

  const rows = await tx.$queryRaw<LockedVoucherRow[]>`
    SELECT
      code,
      kind::text AS kind,
      amount,
      "minSubtotal" AS "minSubtotal",
      "startsAt" AS "startsAt",
      "endsAt" AS "endsAt",
      "usageLimit" AS "usageLimit",
      "perUserLimit" AS "perUserLimit",
      active
    FROM "Voucher"
    WHERE code = ${code}
    FOR UPDATE
  `;
  const v = rows[0];
  if (!v || !v.active) return { ok: false, reason: "Kod nije pronađen ili je istekao" };

  const now = new Date();
  if (v.startsAt && v.startsAt > now) return { ok: false, reason: "Vaučer još nije aktivan" };
  if (v.endsAt && v.endsAt < now) return { ok: false, reason: "Vaučer je istekao" };

  if (v.minSubtotal && subtotal < num(v.minSubtotal)) {
    return {
      ok: false,
      reason: `Vaučer važi za porudžbine preko ${num(v.minSubtotal).toLocaleString("sr-Latn-RS")} RSD`,
    };
  }

  if (v.usageLimit) {
    const used = await tx.voucherRedemption.count({ where: { voucherCode: v.code } });
    if (used >= v.usageLimit) {
      return { ok: false, reason: "Vaučer je iskorišćen" };
    }
  }

  if (v.perUserLimit && userId) {
    const usedByUser = await tx.voucherRedemption.count({
      where: { voucherCode: v.code, userId },
    });
    if (usedByUser >= v.perUserLimit) {
      return { ok: false, reason: "Već ste iskoristili ovaj vaučer" };
    }
  }

  const amount = num(v.amount);
  const isPercent = v.kind === "PERCENT";
  const discountRsd = isPercent
    ? Math.round((subtotal * amount) / 100)
    : Math.min(amount, subtotal);

  const label = isPercent
    ? `−${amount}%`
    : `−${amount.toLocaleString("sr-Latn-RS")} RSD`;

  return {
    ok: true,
    code: v.code,
    label,
    discountRsd,
    kind: isPercent ? "percent" : "fixed",
  };
}
