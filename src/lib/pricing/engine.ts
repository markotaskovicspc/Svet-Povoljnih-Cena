/**
 * Pricing engine (Phase 3D).
 *
 * Centralizes:
 *   1. Effective unit price = active sale price (if action period is valid)
 *      else fullPrice. Period validation lives here so listings, PDP, cart,
 *      and order creation all see the same answer.
 *   2. Order-level discount stack: voucher + first-purchase 5% + saved-card 5%,
 *      clamped by `MAX_STACK_PCT` of the eligible subtotal.
 *
 * All money values are RSD (number, integer dinari). The engine is pure and
 * has no DB or session dependencies — callers project their entities into the
 * `PricingProduct` shape and pass eligibility flags explicitly.
 */

import {
  EXCLUDE_SALE_FROM_STACK,
  FIRST_PURCHASE_PCT,
  MAX_STACK_PCT,
  SAVED_CARD_PCT,
} from "./config";

export interface PricingAction {
  name?: string;
  startsAt: string | Date;
  endsAt: string | Date;
  isPermanent?: boolean | null;
}

export interface PricingProduct {
  fullPrice: number;
  salePrice?: number | null;
  discountPct?: number | null;
  loyaltyPrice?: number | null;
  loyaltyDiscountPct?: number | null;
  action?: PricingAction | null;
  /** Canonical action/product prices; highest live priority wins. */
  actionPrices?: Array<{
    price: number;
    priority: number;
    startsAt: string | Date;
    endsAt: string | Date;
    isPermanent?: boolean | null;
    actionId?: string;
    actionName?: string;
  }>;
  /** Eligible global/category/group promotions already resolved by the caller. */
  linearPromotions?: Array<{
    discountPct: number;
    priority: number;
    startsAt: string | Date;
    endsAt: string | Date;
  }>;
  /** Controls whether the publicly exposed loyalty offer is payable. */
  loyaltyEligible?: boolean;
  /** Admin setting; launch default is 30%. */
  maxCombinedDiscountPct?: number;
}

type PricingActionCandidate = NonNullable<PricingProduct["actionPrices"]>[number];

export interface EffectivePrice {
  /** Unit price the customer actually pays. */
  effective: number;
  /** Original ticket price (always positive). */
  full: number;
  /** Was a valid sale price applied? */
  onSale: boolean;
  /** Which reduced-price source won. */
  kind: "full" | "sale" | "loyalty" | "linear";
  /** Integer percent discount, 0 if none. */
  discountPct: number;
  /** True when product carried a salePrice but the action window expired. */
  actionExpired: boolean;
  /** Percentage supplied by the selected linear promotion, before the cap. */
  linearDiscountPct: number;
  /** Name of the selected product action, when present. */
  actionName?: string;
}

export interface ProductPriceQuote {
  full: number;
  actionOffer: EffectivePrice | null;
  loyaltyOffer: EffectivePrice | null;
  payable: EffectivePrice;
}

function toDate(d: string | Date): Date {
  return d instanceof Date ? d : new Date(d);
}

function isActionLive(action: PricingAction | null | undefined, now: Date): boolean {
  if (!action) return true; // legacy products without action window stay on sale
  const start = toDate(action.startsAt).getTime();
  const end = toDate(action.endsAt).getTime();
  const t = now.getTime();
  return t >= start && t <= end;
}

function resolveLoyaltyPrice(
  product: PricingProduct,
  full: number,
): Pick<EffectivePrice, "effective" | "discountPct"> | null {
  const loyalty =
    product.loyaltyPrice ??
    (product.loyaltyDiscountPct
      ? Math.round(full * (1 - product.loyaltyDiscountPct / 100))
      : null);

  if (loyalty == null || loyalty <= 0 || loyalty >= full) return null;

  return {
    effective: loyalty,
    discountPct:
      product.loyaltyDiscountPct ?? Math.round(((full - loyalty) / full) * 100),
  };
}

function isWindowLive(
  startsAt: string | Date,
  endsAt: string | Date,
  now: Date,
  permanent = false,
) {
  if (permanent) return true;
  const time = now.getTime();
  return time >= toDate(startsAt).getTime() && time <= toDate(endsAt).getTime();
}

/**
 * Deterministic action tie-breaker: priority, newer start, lower customer
 * price, then stable action identity. This keeps PDP, listings and checkout in
 * agreement even when administrators reuse a priority.
 */
export function compareActionPriceCandidates(
  left: PricingActionCandidate,
  right: PricingActionCandidate,
) {
  const priority = right.priority - left.priority;
  if (priority) return priority;

  const leftStart = toDate(left.startsAt).getTime();
  const rightStart = toDate(right.startsAt).getTime();
  if (Number.isFinite(leftStart) && Number.isFinite(rightStart)) {
    const startsAt = rightStart - leftStart;
    if (startsAt) return startsAt;
  }

  const price = left.price - right.price;
  if (price) return price;

  const actionId = (left.actionId ?? "").localeCompare(right.actionId ?? "");
  if (actionId) return actionId;
  return (left.actionName ?? "").localeCompare(right.actionName ?? "");
}

function pricedOffer({
  full,
  base,
  kind,
  linearDiscountPct,
  cap,
  actionExpired,
  actionName,
}: {
  full: number;
  base: number;
  kind: EffectivePrice["kind"];
  linearDiscountPct: number;
  cap: number;
  actionExpired: boolean;
  actionName?: string;
}): EffectivePrice {
  const basePct = ((full - base) / full) * 100;
  const requested = base * (1 - linearDiscountPct / 100);
  const requestedPct = ((full - requested) / full) * 100;
  const appliedPct = Math.max(
    0,
    Math.min(requestedPct, Math.max(cap, basePct)),
  );
  const effective = Math.round(full * (1 - appliedPct / 100));
  const resolvedKind = kind === "full" && effective < full ? "linear" : kind;
  return {
    effective,
    full,
    onSale: resolvedKind === "sale" || resolvedKind === "linear",
    kind: resolvedKind,
    discountPct: Math.round(appliedPct),
    actionExpired,
    linearDiscountPct,
    actionName,
  };
}

export function resolveProductPriceQuote(
  product: PricingProduct,
  options: { now?: Date; loggedIn?: boolean; maxDiscountPct?: number } = {},
): ProductPriceQuote {
  const now = options.now ?? new Date();
  const full = product.fullPrice;
  if (!Number.isFinite(full) || full <= 0) {
    const safeFull = Math.max(0, Number.isFinite(full) ? full : 0);
    const payable: EffectivePrice = {
      effective: safeFull,
      full: safeFull,
      onSale: false,
      kind: "full",
      discountPct: 0,
      actionExpired: false,
      linearDiscountPct: 0,
    };
    return { full: safeFull, actionOffer: null, loyaltyOffer: null, payable };
  }
  const canonicalAction = [...(product.actionPrices ?? [])]
    .filter(
      (candidate) =>
        candidate.price > 0 &&
        candidate.price < full &&
        isWindowLive(
          candidate.startsAt,
          candidate.endsAt,
          now,
          Boolean(candidate.isPermanent),
        ),
    )
    .sort(compareActionPriceCandidates)[0];
  const legacySale =
    !product.actionPrices?.length &&
    product.salePrice != null &&
    product.salePrice > 0 &&
    product.salePrice < full &&
    isActionLive(product.action, now)
      ? product.salePrice
      : null;
  const actionBase = canonicalAction?.price ?? legacySale;
  const actionExpired = Boolean(
    (product.actionPrices?.length && !canonicalAction) ||
      (product.salePrice != null && product.salePrice < full && !legacySale),
  );
  const linear = [...(product.linearPromotions ?? [])]
    .filter(
      (candidate) =>
        candidate.discountPct > 0 &&
        isWindowLive(candidate.startsAt, candidate.endsAt, now),
    )
    .sort((left, right) => right.priority - left.priority)[0];
  const cap =
    options.maxDiscountPct ?? product.maxCombinedDiscountPct ?? MAX_STACK_PCT;
  const linearPct = linear?.discountPct ?? 0;
  const publicPrice = pricedOffer({
    full,
    base: actionBase ?? full,
    kind: actionBase == null ? "full" : "sale",
    linearDiscountPct: linearPct,
    cap,
    actionExpired,
    actionName: canonicalAction?.actionName ?? product.action?.name,
  });
  const loyaltyBase = resolveLoyaltyPrice(product, full);
  const loyaltyOffer = loyaltyBase
    ? pricedOffer({
        full,
        base: loyaltyBase.effective,
        kind: "loyalty",
        linearDiscountPct: linearPct,
        cap,
        actionExpired,
      })
    : null;
  const eligible = options.loggedIn ?? product.loyaltyEligible ?? false;
  const payable =
    eligible && loyaltyOffer && loyaltyOffer.effective < publicPrice.effective
      ? loyaltyOffer
      : publicPrice;
  return {
    full,
    actionOffer: publicPrice.effective < full ? publicPrice : null,
    loyaltyOffer,
    payable,
  };
}

export function resolvePromotionPrice(
  product: PricingProduct,
  options: { now?: Date; loggedIn?: boolean; maxDiscountPct?: number } = {},
): EffectivePrice {
  return resolveProductPriceQuote(product, options).payable;
}

/**
 * Resolves the effective unit price for a product. If the product carries a
 * `salePrice` but its `action` window has lapsed, the price falls back to
 * loyalty pricing when available, then to `fullPrice`.
 */
export function effectiveUnitPrice(
  product: PricingProduct,
  now: Date = new Date(),
): EffectivePrice {
  return resolveProductPriceQuote(product, {
    now,
    loggedIn: product.loyaltyEligible,
    maxDiscountPct: product.maxCombinedDiscountPct,
  }).payable;
}

// ─────────────────────────────────────────────────────────────────────────
// Order-level pricing
// ─────────────────────────────────────────────────────────────────────────

export interface PricingLine {
  sku: string;
  qty: number;
  product: PricingProduct;
}

export interface PricingResolvedLine {
  sku: string;
  qty: number;
  unitPriceFull: number;
  unitPriceSale: number;
  /** qty × unitPriceSale */
  lineTotal: number;
  /** qty × (unitPriceFull − unitPriceSale) */
  lineSavings: number;
  onSale: boolean;
}

export interface VoucherInput {
  code: string;
  /** Already-validated discount in RSD (positive). */
  discountRsd: number;
}

export interface PricingEligibility {
  /** First-ever order for this user (after fraud checks, etc.). */
  firstPurchase?: boolean;
  /** User chose to pay with a tokenized saved card. */
  savedCard?: boolean;
}

export interface PricingOptions {
  /** Override the engine's "now" (for tests / admin previews). */
  now?: Date;
  /** Override stack cap. */
  maxStackPct?: number;
}

export interface OrderPricing {
  lines: PricingResolvedLine[];
  /** Σ unitPriceSale × qty (post-effective-price, pre-order-discounts). */
  subtotal: number;
  /** Σ savings from item-level discounts (full − sale). */
  savings: number;
  /** Subtotal portion eligible for order-level discounts. */
  eligibleForStack: number;
  /** Voucher discount actually applied (after clamping). */
  voucherDiscount: number;
  voucherCode: string | null;
  /** First-purchase 5% applied (after clamping). */
  firstPurchaseDiscount: number;
  /** Saved-card 5% applied (after clamping). */
  savedCardDiscount: number;
  /** Voucher + first-purchase + saved-card, after stack cap. */
  totalOrderDiscount: number;
  /** Whether the cap clipped any discount. */
  stackCapped: boolean;
}

/**
 * Computes the full order pricing. Voucher must be pre-validated; eligibility
 * must be pre-resolved by the caller (server has the auth context, the engine
 * does not).
 */
export function computeOrderPricing({
  lines,
  voucher,
  eligibility,
  options,
}: {
  lines: PricingLine[];
  voucher?: VoucherInput | null;
  eligibility?: PricingEligibility;
  options?: PricingOptions;
}): OrderPricing {
  const now = options?.now ?? new Date();
  const cap = options?.maxStackPct ?? MAX_STACK_PCT;

  const resolved: PricingResolvedLine[] = lines.map((l) => {
    const e = effectiveUnitPrice(l.product, now);
    return {
      sku: l.sku,
      qty: l.qty,
      unitPriceFull: e.full,
      unitPriceSale: e.effective,
      lineTotal: e.effective * l.qty,
      lineSavings: (e.full - e.effective) * l.qty,
      onSale: e.onSale,
    };
  });

  const subtotal = resolved.reduce((n, r) => n + r.lineTotal, 0);
  const savings = resolved.reduce((n, r) => n + r.lineSavings, 0);

  const eligibleForStack = EXCLUDE_SALE_FROM_STACK
    ? resolved.filter((r) => !r.onSale).reduce((n, r) => n + r.lineTotal, 0)
    : subtotal;

  const requested = {
    voucher: voucher?.discountRsd ?? 0,
    first: eligibility?.firstPurchase ? Math.round((eligibleForStack * FIRST_PURCHASE_PCT) / 100) : 0,
    card: eligibility?.savedCard ? Math.round((eligibleForStack * SAVED_CARD_PCT) / 100) : 0,
  };

  const requestedTotal = requested.voucher + requested.first + requested.card;
  const maxAllowed = Math.round((eligibleForStack * cap) / 100);

  let applied = { ...requested };
  let stackCapped = false;

  if (requestedTotal > maxAllowed && requestedTotal > 0) {
    stackCapped = true;
    // Scale each component proportionally to fit under the cap.
    const scale = maxAllowed / requestedTotal;
    applied = {
      voucher: Math.floor(requested.voucher * scale),
      first: Math.floor(requested.first * scale),
      card: Math.floor(requested.card * scale),
    };
  }

  const totalOrderDiscount = Math.min(
    applied.voucher + applied.first + applied.card,
    eligibleForStack,
  );

  return {
    lines: resolved,
    subtotal,
    savings,
    eligibleForStack,
    voucherDiscount: applied.voucher,
    voucherCode: voucher?.code ?? null,
    firstPurchaseDiscount: applied.first,
    savedCardDiscount: applied.card,
    totalOrderDiscount,
    stackCapped,
  };
}
