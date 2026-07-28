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
