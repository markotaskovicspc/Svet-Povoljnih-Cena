/** 1 October 2026, 00:00 Europe/Belgrade (CEST). Evaluated per calculation. */
export const OCTOBER_TERMS_AT_MS = Date.parse("2026-10-01T00:00:00+02:00");

const SEPTEMBER_TERMS = { id: "2026-09", firstPurchasePct: 15, freeCategoryOneThresholdRsd: 4_000 } as const;
const OCTOBER_TERMS = { id: "2026-10", firstPurchasePct: 10, freeCategoryOneThresholdRsd: 20_000 } as const;

export function commerceTermsAt(at: Date | number = Date.now()) {
  const ms = typeof at === "number" ? at : at.getTime();
  return ms >= OCTOBER_TERMS_AT_MS ? OCTOBER_TERMS : SEPTEMBER_TERMS;
}

export function firstPurchaseDiscountPct(at: Date | number = Date.now()) {
  return commerceTermsAt(at).firstPurchasePct;
}

/** Replace only the old September delivery promotion, leaving other CMS campaigns alone. */
export function scheduledDeliveryPromoText(text: string, at: Date | number = Date.now()) {
  return commerceTermsAt(at).id === "2026-10" && /dostav|isporuk/i.test(text) && /4[.\s]?000/.test(text)
    ? "Besplatna dostava od 20.000 RSD za standardne pakete (I kategorija)."
    : text;
}
