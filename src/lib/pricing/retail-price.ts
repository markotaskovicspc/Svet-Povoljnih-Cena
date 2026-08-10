type RetailPriceCandidate = {
  price: { toNumber(): number } | number;
  validFrom: Date;
  validTo: Date | null;
  priceList: {
    id: string;
    name: string;
    code: string;
    active: boolean;
    validFrom: Date | null;
    validTo: Date | null;
  };
};

type PublicActionPriceCandidate = {
  salePrice: { toNumber(): number } | number;
  action: {
    startsAt: Date;
    endsAt: Date;
    priority: number;
    isPermanent?: boolean | null;
  };
};

function isDateActive(from: Date | null, to: Date | null, now: Date) {
  return (!from || from <= now) && (!to || to >= now);
}

export function resolveRetailPrice(
  entries: RetailPriceCandidate[],
  fallback: { toNumber(): number } | number,
  now = new Date(),
) {
  const entry = entries.find(
    (candidate) =>
      candidate.priceList.active &&
      isDateActive(candidate.priceList.validFrom, candidate.priceList.validTo, now) &&
      isDateActive(candidate.validFrom, candidate.validTo, now),
  );
  const price = entry
    ? typeof entry.price === "number"
      ? entry.price
      : entry.price.toNumber()
    : typeof fallback === "number"
      ? fallback
      : fallback.toNumber();
  return {
    price,
    source: entry
      ? {
          type: "PRICE_LIST" as const,
          priceListId: entry.priceList.id,
          priceListName: entry.priceList.name,
          priceListCode: entry.priceList.code,
        }
      : { type: "LEGACY_PRODUCT" as const },
  };
}

/** Lowest public (non-loyalty) price in the 30 days before the live offer. */
export function lowestPublicPriceLast30Days(
  entries: RetailPriceCandidate[],
  actionPrices: PublicActionPriceCandidate[],
  fallback: { toNumber(): number } | number,
  now = new Date(),
) {
  const activeAction = actionPrices
    .filter(
      (candidate) =>
        !candidate.action.isPermanent &&
        candidate.action.startsAt <= now &&
        candidate.action.endsAt >= now,
    )
    .sort(
      (left, right) =>
        right.action.priority - left.action.priority ||
        right.action.startsAt.getTime() - left.action.startsAt.getTime(),
    )[0];
  const referenceAt = activeAction?.action.startsAt ?? now;
  const windowStart = new Date(referenceAt.getTime() - 30 * 24 * 60 * 60 * 1_000);
  const prices = [
    ...entries
      .filter(
        (entry) =>
          entry.priceList.active &&
          entry.validFrom <= referenceAt &&
          (!entry.validTo || entry.validTo >= windowStart) &&
          (!entry.priceList.validFrom || entry.priceList.validFrom <= referenceAt) &&
          (!entry.priceList.validTo || entry.priceList.validTo >= windowStart),
      )
      .map((entry) =>
        typeof entry.price === "number" ? entry.price : entry.price.toNumber(),
      ),
    ...actionPrices
      .filter(
        (candidate) =>
          !candidate.action.isPermanent &&
          candidate.action.startsAt < referenceAt &&
          candidate.action.endsAt >= windowStart,
      )
      .map((candidate) =>
        typeof candidate.salePrice === "number"
          ? candidate.salePrice
          : candidate.salePrice.toNumber(),
      ),
  ].filter((price) => Number.isFinite(price) && price > 0);
  const fallbackPrice =
    typeof fallback === "number" ? fallback : fallback.toNumber();
  return prices.length ? Math.min(...prices) : fallbackPrice;
}
