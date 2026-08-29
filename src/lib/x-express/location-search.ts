import { searchSerbianPlaces } from "@/data/serbian-places";

function normalized(value: string) {
  return value
    .trim()
    .toLocaleLowerCase("sr-Latn-RS")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "dj");
}

/**
 * Expands a customer query with canonical Serbian spellings so the X Express
 * dictionary can still be searched when diacritics are omitted (for example
 * "Nis" -> "Niš"). The provider town IDs remain the source of truth.
 */
export function xExpressTownSearchTerms(query: string) {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const queryKey = normalized(trimmed);
  const canonicalMatches = searchSerbianPlaces(trimmed, 20)
    .filter((place) => normalized(place.name).startsWith(queryKey))
    .map((place) => place.name);

  return Array.from(new Set([trimmed, ...canonicalMatches]));
}
