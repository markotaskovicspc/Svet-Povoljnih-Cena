const MAX_ARTICLE_NAME_LENGTH = 200;

export function normalizeArticleText(value: string | null | undefined) {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

export function composeArticleName(input: {
  collection?: string | null;
  shortDescription?: string | null;
  shortName?: string | null;
}) {
  const parts = [
    normalizeArticleText(input.collection),
    normalizeArticleText(input.shortDescription),
    normalizeArticleText(input.shortName),
  ].filter(Boolean);
  const composed = parts.join(" ").trim();
  return composed.slice(0, MAX_ARTICLE_NAME_LENGTH);
}

export function splitArticleValues(value: string | string[] | null | undefined) {
  const values = Array.isArray(value) ? value : value?.split(/[,;\n]+/) ?? [];
  const unique = new Map<string, string>();
  for (const item of values) {
    const normalized = normalizeArticleText(item);
    if (!normalized) continue;
    unique.set(normalized.toLocaleLowerCase("sr-Latn"), normalized);
  }
  return Array.from(unique.values());
}

export function articleSlug(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 96);
}

export function optionalDateInput(value: string | null | undefined) {
  if (!value?.trim()) return null;
  const parsed = new Date(`${value.trim()}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Datum „${value}” nije ispravan.`);
  }
  return parsed;
}

export function dateInputValue(value: Date | string | null | undefined) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}
