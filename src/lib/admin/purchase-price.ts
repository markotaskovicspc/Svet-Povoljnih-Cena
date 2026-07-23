export const PURCHASE_PRICE_MAX = 9_999_999_999.99;

type PurchasePriceArticleFields = {
  attribute1?: string | null;
  attribute2?: string | null;
  attribute3?: string | null;
  attribute4?: string | null;
  sizeLabel?: string | null;
  colorPrimary?: string | null;
  colorSecondary?: string | null;
};

function nonEmpty(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed || null;
}

export function composePurchasePriceAttributes(
  article: PurchasePriceArticleFields,
) {
  const attributes = [
    article.attribute1,
    article.attribute2,
    article.attribute3,
    article.attribute4,
  ]
    .map(nonEmpty)
    .filter((value): value is string => Boolean(value));

  return attributes.join(" / ") || nonEmpty(article.sizeLabel);
}

export function composePurchasePricePattern(
  article: PurchasePriceArticleFields,
) {
  return [article.colorPrimary, article.colorSecondary]
    .map(nonEmpty)
    .filter((value): value is string => Boolean(value))
    .join(" + ") || null;
}

export function normalizePurchasePriceSku(value: unknown) {
  if (typeof value !== "string") {
    throw new Error("Šifra artikla je obavezna.");
  }
  const sku = value.trim();
  if (!sku) throw new Error("Šifra artikla je obavezna.");
  if (sku.length > 100) throw new Error("Šifra artikla je predugačka.");
  return sku;
}

export function parsePurchasePriceValue(value: unknown) {
  const raw =
    typeof value === "number"
      ? String(value)
      : typeof value === "string"
        ? value.trim().replace(",", ".")
        : "";

  if (!/^\d{1,10}(?:\.\d{1,2})?$/.test(raw)) {
    throw new Error("Nabavna cena mora biti nenegativan broj sa najviše dve decimale.");
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed > PURCHASE_PRICE_MAX) {
    throw new Error(
      `Nabavna cena ne može biti veća od ${PURCHASE_PRICE_MAX.toLocaleString("sr-Latn-RS")}.`,
    );
  }
  return raw;
}

export function parsePurchasePriceDate(value: unknown, label: string) {
  if (typeof value !== "string") {
    throw new Error(`${label} mora biti ispravan datum.`);
  }
  const raw = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new Error(`${label} mora biti ispravan datum.`);
  }
  const date = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== raw) {
    throw new Error(`${label} mora biti ispravan datum.`);
  }
  return date;
}

export function validatePurchasePricePeriod(
  validFrom: Date,
  validTo: Date | null,
) {
  if (validTo && validTo.getTime() < validFrom.getTime()) {
    throw new Error("Datum „Važenje cene do” ne može biti pre datuma „od”.");
  }
}
