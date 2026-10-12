import { SERBIAN_PLACES } from "@/data/serbian-places";
import { normalizeSerbianSearch } from "@/lib/serbian-search";
import { exactTownAlias } from "@/lib/x-express/town-aliases";

export type ImportTown = { id: number; name: string; displayName?: string | null; postalCode?: string | null };
export type ImportPlace = { city: string; postalCode: string; xExpressTownId: number };

/** Comparison only: never replace the displayed address with these keys. */
export function importTownKey(value: string) {
  return normalizeSerbianSearch(value).replace(/[^a-z0-9]+/g, " ").trim()
    .split(/\s+/).map(token => ((({ bg: "beograd", bgd: "beograd", ns: "novi sad" } as Record<string, string>)[token]) ?? token)).join(" ");
}
const placeAliases = new Map(SERBIAN_PLACES.map(place => [importTownKey(place.name), (place.aliases ?? []).map(importTownKey)]));
function keys(town: ImportTown) {
  const labels = [town.name, town.displayName?.replace(/\s*[-–—]\s*\d{5}\s*$/, "")].filter((n): n is string => !!n);
  const names = labels.map(importTownKey);
  // Reorder only hierarchy components, not words inside the locality name.
  for (const label of labels) {
    const hierarchy = label.match(/^(.+?)\s*(?:\((.+)\)|[—–-]\s*(.+))$/);
    if (hierarchy) names.push(importTownKey(`${hierarchy[2] ?? hierarchy[3]} ${hierarchy[1]}`));
  }
  for (const name of [...names]) names.push(...(placeAliases.get(name) ?? []));
  return names;
}
function candidates(towns: ImportTown[], city: string) {
  const key = importTownKey(city);
  return key ? towns.filter(t => keys(t).includes(key)) : [];
}
export function matchImportTown(towns: ImportTown[], city: string, postalCode = ""): ImportPlace | null {
  const exact = candidates(towns, city);
  const samePostal = exact.filter(t => t.postalCode === postalCode);
  const town = exact.length === 1 ? exact[0] : samePostal.length === 1 ? samePostal[0] : null;
  if (town && /^\d{5}$/.test(town.postalCode ?? ""))
    return { city: town.name, postalCode: town.postalCode!, xExpressTownId: town.id };
  // An ambiguous actual locality must never fall through to a routing alias.
  if (exact.length) return null;
  const alias = exactTownAlias(city);
  const parent = alias && towns.find(t => t.id === alias.townId && t.name === alias.townName);
  return alias && parent ? { city: alias.name, postalCode: alias.postalCode, xExpressTownId: parent.id } : null;
}
function nearby(a: string, b: string) {
  if (a.length < 5 || Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length >= b.length) i++;
    if (b.length >= a.length) j++;
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}
export function searchImportTowns(towns: ImportTown[], city: string, postalCode = "") {
  const resolved = matchImportTown(towns, city, postalCode);
  if (resolved) return [{ name: resolved.city, postalCode: resolved.postalCode, townId: resolved.xExpressTownId, autoResolved: true }];
  const key = importTownKey(city);
  const exact = candidates(towns, city);
  const matches = exact.length ? exact : towns.filter(t => keys(t).some(n => n.includes(key) || nearby(key, n)) || t.postalCode === city);
  return matches.filter(t => /^\d{5}$/.test(t.postalCode ?? "")).slice(0, 20)
    .map(t => ({ name: t.name, postalCode: t.postalCode!, townId: t.id, displayName: t.displayName, autoResolved: false }));
}
