export const AUTOMATIC_ARTICLE_SKU_FLOOR = 100_000;

export function normalizeArticleSku(value: unknown) {
  if (typeof value !== "string") throw new Error("Šifra artikla je obavezna.");
  const sku = value.trim();
  if (!sku) throw new Error("Šifra artikla je obavezna.");
  if (sku.length > 80) throw new Error("Šifra artikla može imati najviše 80 znakova.");
  if (/\p{C}/u.test(sku)) {
    throw new Error("Šifra artikla sadrži nedozvoljen kontrolni znak.");
  }
  if (/\s/u.test(sku)) {
    throw new Error("Šifra artikla ne može da sadrži razmake.");
  }
  return sku;
}

export function numericArticleSku(value: unknown) {
  if (typeof value !== "string") return null;
  const sku = value.trim();
  const isPlainNumber = /^\d+$/.test(sku);
  const isGroupedNumber = /^\d{1,3}(?:\.\d{3})+$/.test(sku);
  if (!isPlainNumber && !isGroupedNumber) return null;
  const number = Number(sku.replaceAll(".", ""));
  return Number.isSafeInteger(number) ? number : null;
}

export function nextAvailableArticleSku(
  existingSkus: Iterable<string>,
  floor = AUTOMATIC_ARTICLE_SKU_FLOOR,
) {
  const used = new Set<number>();
  for (const sku of existingSkus) {
    const number = numericArticleSku(sku);
    if (number !== null && number > floor) used.add(number);
  }

  let candidate = floor + 1;
  while (used.has(candidate)) candidate += 1;
  if (!Number.isSafeInteger(candidate)) {
    throw new Error("Automatska šifra artikla nije mogla da se rezerviše.");
  }
  return String(candidate);
}
