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
  action?: PricingAction | null;
}

export interface EffectivePrice {
  /** Unit price the customer actually pays. */
  effective: number;
  /** Original ticket price (always positive). */
  full: number;
  /** Was a valid sale price applied? */
  onSale: boolean;
  /** Integer percent discount, 0 if none. */
  discountPct: number;
  /** True when product carried a salePrice but the action window expired. */
  actionExpired: boolean;
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

/**
 * Resolves the effective unit price for a product. If the product carries a
 * `salePrice` but its `action` window has lapsed, the price reverts to
 * `fullPrice` (per plan 3D — item 3).
 */
export function effectiveUnitPrice(
  product: PricingProduct,
  now: Date = new Date(),
): EffectivePrice {
  const full = product.fullPrice;
  const sale = product.salePrice ?? null;
  if (sale == null || sale >= full) {
    return { effective: full, full, onSale: false, discountPct: 0, actionExpired: false };
  }
  const live = isActionLive(product.action, now);
  if (!live) {
    return { effective: full, full, onSale: false, discountPct: 0, actionExpired: true };
  }
  const pct = product.discountPct ?? Math.round(((full - sale) / full) * 100);
  return { effective: sale, full, onSale: true, discountPct: pct, actionExpired: false };
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
