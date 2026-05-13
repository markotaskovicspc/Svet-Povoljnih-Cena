/**
 * Centralized hero/badge derivation (Phase 3D — item 4).
 *
 * Listings, PDP, and email templates all derive their badge stack from this
 * function so a single rule change ripples everywhere. The output is ordered
 * by visual priority (most important first); UIs can `.slice(0, n)` and roll
 * the rest into a "+N" overflow chip.
 */

import { effectiveUnitPrice, type PricingProduct } from "./engine";

export type BadgeKey =
  | "discount"
  | "hero"
  | "action"
  | "new"
  | "limited"
  | "dtz";

export type BadgeTone = "action" | "gold" | "olive" | "amber" | "red" | "ink";

export interface Badge {
  key: BadgeKey;
  label: string;
  tone: BadgeTone;
}

export interface BadgeProduct extends PricingProduct {
  isHero?: boolean | null;
  isNew?: boolean | null;
  newUntil?: string | Date | null;
  isLimited?: boolean | null;
  isDtz?: boolean | null;
  stock?: number | null;
}

const DTZ_LOW_STOCK_THRESHOLD = 15;

function isNewActive(p: BadgeProduct, now: Date): boolean {
  if (!p.isNew) return false;
  if (!p.newUntil) return true;
  return new Date(p.newUntil).getTime() >= now.getTime();
}

/**
 * Returns the ordered badge list for a product. The rules:
 *   1. Discount pill (only when sale is currently live — uses the engine).
 *   2. Heroj meseca.
 *   3. Action name (e.g. "Nedeljna akcija") if its window is live.
 *   4. Novo (respects `newUntil`).
 *   5. Ograničena količina.
 *   6. Dok traju zalihe — only when stock is below the threshold.
 */
export function deriveBadges(p: BadgeProduct, now: Date = new Date()): Badge[] {
  const out: Badge[] = [];
  const price = effectiveUnitPrice(p, now);

  if (price.onSale && price.discountPct > 0) {
    out.push({ key: "discount", label: `-${price.discountPct}%`, tone: "action" });
  }
  if (p.isHero) {
    out.push({ key: "hero", label: "Heroj meseca", tone: "gold" });
  }
  if (price.onSale && p.action?.name) {
    out.push({
      key: "action",
      label: p.action.isPermanent ? "Niske cene" : p.action.name,
      tone: "ink",
    });
  }
  if (isNewActive(p, now)) {
    out.push({ key: "new", label: "Novo", tone: "olive" });
  }
  if (p.isLimited) {
    out.push({ key: "limited", label: "Ograničena količina", tone: "amber" });
  }
  if (p.isDtz && (p.stock ?? Infinity) < DTZ_LOW_STOCK_THRESHOLD) {
    out.push({ key: "dtz", label: "Dok traju zalihe", tone: "red" });
  }
  return out;
}

/**
 * `isHeroProduct` mirrors the listing/featured logic: a product is a hero
 * when it carries the explicit flag AND has a currently-live action (or no
 * action window at all). Used by section rails and "Heroji meseca" rollups.
 */
export function isHeroProduct(p: BadgeProduct, now: Date = new Date()): boolean {
  if (!p.isHero) return false;
  const price = effectiveUnitPrice(p, now);
  // A hero with an expired action loses its hero status until renewed.
  if (p.action && price.actionExpired) return false;
  return true;
}
