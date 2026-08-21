import type { Prisma } from "@prisma/client";

export const STOREFRONT_TIME_ZONE = "Europe/Belgrade";

interface StorefrontHeroAction {
  kind?: string | null;
  startsAt: string | Date;
  endsAt: string | Date;
  isPermanent?: boolean | null;
}

interface StorefrontHeroProduct {
  sku: string;
  isHero?: boolean | null;
  action?: StorefrontHeroAction | null;
  actionPrices?: Array<{ action: StorefrontHeroAction }> | null;
}

export function storefrontMonth(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: STOREFRONT_TIME_ZONE,
    year: "numeric",
    month: "numeric",
  }).formatToParts(date);
  const value = (type: "year" | "month") =>
    Number(parts.find((part) => part.type === type)?.value);

  return { year: value("year"), month: value("month") };
}

function isLiveHeroAction(action: StorefrontHeroAction, now: Date) {
  if (action.kind !== "HEROJI") return false;
  if (action.isPermanent) return true;
  const time = now.getTime();
  return (
    new Date(action.startsAt).getTime() <= time &&
    new Date(action.endsAt).getTime() >= time
  );
}

/**
 * Resolves every canonical source of the storefront "Heroj meseca" status.
 * `Product.isHero` is retained for legacy/imported products, while the ERP
 * action editor writes month-scoped assignments to `HeroOfMonth`.
 */
export function isStorefrontHeroProduct(
  product: StorefrontHeroProduct,
  monthlyHeroSkus: ReadonlySet<string>,
  now: Date = new Date(),
) {
  return Boolean(
    product.isHero ||
      monthlyHeroSkus.has(product.sku) ||
      (product.action && isLiveHeroAction(product.action, now)) ||
      product.actionPrices?.some(({ action }) =>
        isLiveHeroAction(action, now),
      ),
  );
}

export function heroProductsWhere(
  now: Date,
  monthlyHeroSkus: string[],
): Prisma.ProductWhereInput {
  const liveHeroAction: Prisma.ActionWhereInput = {
    kind: "HEROJI",
    OR: [
      { isPermanent: true },
      { startsAt: { lte: now }, endsAt: { gte: now } },
    ],
  };

  return {
    OR: [
      { isHero: true },
      { action: { is: liveHeroAction } },
      {
        actionPrices: {
          some: { action: { is: liveHeroAction } },
        },
      },
      ...(monthlyHeroSkus.length
        ? [{ sku: { in: monthlyHeroSkus } } satisfies Prisma.ProductWhereInput]
        : []),
    ],
  };
}

export function limitedOfferProductsWhere(): Prisma.ProductWhereInput {
  return {
    OR: [{ isLimited: true }, { isDtz: true }],
  };
}

/** Defense-in-depth for supplier catalogs that do not own promo flags. */
export function excludeRabaluxPromotionProductsWhere(): Prisma.ProductWhereInput {
  return {
    OR: [
      { supplier: { is: null } },
      { supplier: { is: { integrationKey: null } } },
      {
        supplier: {
          is: { integrationKey: { not: "RABALUX" } },
        },
      },
    ],
  };
}

export function permanentPriceProductsWhere(): Prisma.ProductWhereInput {
  return {
    OR: [
      { action: { is: { isPermanent: true } } },
      {
        actionPrices: {
          some: { action: { is: { isPermanent: true } } },
        },
      },
    ],
  };
}
