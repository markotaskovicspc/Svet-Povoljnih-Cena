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

/** Correct the published September paragraph while retaining the rest of the CMS revision. */
export function scheduledDeliveryTermsMarkdown(markdown: string) {
  return markdown.replace(
    "Od 1. septembra 2026., dostava artikala I kategorije je besplatna kada njihov zbir iznosi 4.000 RSD ili više.",
    "Do 30. septembra 2026. dostava artikala I kategorije (standardni paketi) je besplatna kada njihov zbir iznosi 4.000 RSD ili više. Od 1. oktobra 2026. u 00:00, po vremenu u Srbiji, prag za besplatnu dostavu tih artikala je 20.000 RSD.",
  );
}

// Match these exact old image assets, so future CMS uploads are unaffected.
export function isSeptemberDeliveryImage(url: string) {
  return url.includes("1788249570385-84e358deb7361629-desktop.webp") || url.includes("1788248916572-ac8292ed7b916ac0-mobile.webp");
}

export function isLegacyFirstPurchaseImage(url: string) {
  return url.includes("1787933740542-7b9a9155566c9637-desktop.webp") || url.includes("1787942816765-149924fd3f4303ab-mobile.webp");
}

/** Replace only the old September delivery promotion, leaving other CMS campaigns alone. */
export function scheduledDeliveryPromoText(text: string, at: Date | number = Date.now()) {
  return commerceTermsAt(at).id === "2026-10" && /dostav|isporuk/i.test(text) && /4[.\s]?000/.test(text)
    ? "Besplatna dostava od 20.000 RSD za standardne pakete (I kategorija)."
    : text;
}
