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
  | "permanent"
  | "hero"
  | "action"
  | "new"
  | "limited"
  | "dtz";

export type BadgeTone =
  | "action"
  | "gold"
  | "olive"
  | "amber"
  | "red"
  | "ink"
  | "protected";

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
 * Returns all commercial badges. Product images should use
 * `deriveImageBadges`, while section/action labels can use
 * `deriveActionBadges` for the non-image campaign chips.
 */
export function deriveBadges(p: BadgeProduct, now: Date = new Date()): Badge[] {
  const out: Badge[] = [];
  const price = effectiveUnitPrice(p, now);

  if (p.action?.isPermanent) {
    out.push({
      key: "permanent",
      label: "Trajno niska cena",
      tone: "protected",
    });
  }
  if (p.isHero) {
    out.push({ key: "hero", label: "Heroj meseca", tone: "gold" });
  }
  if (price.discountPct > 0 && (price.kind === "sale" || price.kind === "loyalty")) {
    out.push({ key: "discount", label: `-${price.discountPct}%`, tone: "action" });
  }
  if (price.onSale && p.action?.name) {
    out.push({
      key: "action",
      label: p.action.isPermanent ? "Trajno niska cena" : p.action.name,
      tone: "ink",
    });
  }
  if (isNewActive(p, now)) {
    out.push({ key: "new", label: "Novo", tone: "olive" });
  }
  if (p.isLimited) {
    out.push({ key: "limited", label: "Dok traju zalihe", tone: "amber" });
  }
  if (p.isDtz && (p.stock ?? Infinity) < DTZ_LOW_STOCK_THRESHOLD) {
    out.push({ key: "dtz", label: "Dok traju zalihe", tone: "red" });
  }
  return out;
}

export function deriveImageBadges(
  p: BadgeProduct,
  now: Date = new Date(),
): { topLeft: Badge[]; bottomLeft: Badge[] } {
  const badges = deriveBadges(p, now);
  const first = (key: BadgeKey) => badges.find((b) => b.key === key);
  const topLeft = [
    first("discount"),
    first("action"),
    first("permanent"),
    first("hero"),
  ].filter(Boolean).slice(0, 2) as Badge[];
  const bottomLeft = [
    first("limited") ?? first("dtz"),
    first("new"),
  ].filter(Boolean).slice(0, 1) as Badge[];
  return { topLeft, bottomLeft };
}

export function deriveActionBadges(p: BadgeProduct, now: Date = new Date()): Badge[] {
  return deriveBadges(p, now).filter((b) => b.key === "action");
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
