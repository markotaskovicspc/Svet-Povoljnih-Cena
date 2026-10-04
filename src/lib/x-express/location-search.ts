import { searchSerbianPlaces, normalizeSerbianPlaceSearch } from "@/data/serbian-places";

export const normalizedTownQuery = (value: string) => normalizeSerbianPlaceSearch(value.trim());

/**
 * Expands a customer query with canonical Serbian spellings so the X Express
 * dictionary can still be searched when diacritics are omitted (for example
 * "Nis" -> "Niš"). The provider town IDs remain the source of truth.
 */
export function xExpressTownSearchTerms(query: string) {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const canonicalMatches = searchSerbianPlaces(trimmed, 20)
    .map((place) => place.name);

  return Array.from(new Set([trimmed, ...canonicalMatches]));
}
