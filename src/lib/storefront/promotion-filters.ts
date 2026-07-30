import type { Prisma } from "@prisma/client";

export const STOREFRONT_TIME_ZONE = "Europe/Belgrade";

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
