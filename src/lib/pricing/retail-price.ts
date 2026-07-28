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
