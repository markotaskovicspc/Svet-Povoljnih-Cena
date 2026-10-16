import { SERBIAN_PLACES, searchSerbianPlaces, normalizeSerbianPlaceSearch } from "@/data/serbian-places";

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
    .flatMap((place) => [place.name, place.name.replace(/^Beograd — /, "")]);

  return Array.from(new Set([trimmed, ...canonicalMatches]));
}

/** Select municipality seats by postcode too: Lazarevac, Sopot and Obrenovac
 * also name unrelated towns elsewhere in Serbia. IDs still come from the courier. */
export function beogradMunicipalitySeats(query: string) {
  if (normalizedTownQuery(query) !== "beograd") return [];
  const names = new Set(["Barajevo", "Grocka", "Lazarevac", "Mladenovac", "Obrenovac", "Sopot", "Surčin"]);
  return SERBIAN_PLACES.filter(place => names.has(place.name));
}
