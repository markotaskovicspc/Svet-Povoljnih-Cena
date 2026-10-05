import "server-only";
import { canonicalPickupStreet, samePickupStreet } from "./pickup-street-aliases";
import { splitStreetAndHouseNumber } from "./house-number";
import type { XExpressPickupCoordinates } from "@/lib/x-express/return";

export type PickupAddress = {
  shipStreet: string;
  shipHouseNumber?: string | null;
  shipCity: string;
};

export class PickupGeocodingError extends Error {}

function addressError(reason: string, instruction: string) {
  return new PickupGeocodingError(
    `Lokacija preuzimanja nije pouzdano pronađena. ${reason} ${instruction} Nalog nije poslat kuriru.`,
  );
}
function quoted(value: string) { return `„${value.slice(0, 120)}“`; }
const CYRILLIC: Record<string, string> = Object.fromEntries(
  [..."абвгдђежзијклљмнњопрстћуфхцчџш"].map((letter, index) => [
    letter, ["a", "b", "v", "g", "d", "dj", "e", "z", "z", "i", "j", "k", "l", "lj", "m", "n", "nj", "o", "p", "r", "s", "t", "c", "u", "f", "h", "c", "c", "dz", "s"][index],
  ]),
);

function normalize(value: string) {
  return value.toLowerCase().replace(/[а-яђјљњћџ]/g, (letter) => CYRILLIC[letter] ?? letter)
    .replace(/đ/g, "dj").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/^ulica\s+/, "").replace(/[^a-z0-9]/g, "");
}

type Component = { long_name: string; short_name: string; types: string[] };
type Result = {
  partial_match?: boolean;
  types: string[];
  address_components: Component[];
  geometry: { location_type: string; location: { lat: number; lng: number } };
};

/** One server-side lookup per new pickup; never log the URL/key or cache the
 * Google response across customers. Only the courier request retains the point. */
export async function geocodePickupAddress(address: PickupAddress): Promise<XExpressPickupCoordinates> {
  const key = process.env.GOOGLE_MAPS_API_KEY?.trim();
  if (!key || key.startsWith("GET_FROM_")) {
    throw new PickupGeocodingError("Automatsko pronalaženje adrese nije podešeno. Administrator treba da podesi Google Maps API ključ.");
  }
  const { street, houseNumber } = splitStreetAndHouseNumber(address.shipStreet, address.shipHouseNumber);
  // Courier towns may include a municipal qualifier, e.g. Beograd (Vračar).
  // Google uses the locality component for the city. Postal codes refer to
  // delivery offices and are not a reliable building-location discriminator.
  const city = address.shipCity.replace(/\s*\([^)]*\)\s*/g, " ").trim();
  if (!street) throw addressError("Nedostaje naziv ulice.", "Proverite ulicu u adresi porudžbine.");
  if (!houseNumber) throw addressError("Nedostaje važeći kućni broj.", "Proverite ulicu i unesite ceo kućni broj u adresi porudžbine.");
  if (houseNumber === "bb") throw addressError("Adresa je bez kućnog broja (bb), pa objekat ne može automatski da se potvrdi.", "Proverite ulicu i unesite tačan broj ako postoji; ako ne postoji, unesite lokaciju objekta potvrđenu sa kupcem u polje „Potvrđena lokacija kupca“ na reklamaciji.");
  if (!city) throw addressError("Nedostaje mesto preuzimanja.", "Proverite ulicu i izaberite mesto u adresi porudžbine.");
  const lookupStreet = canonicalPickupStreet(street, city);
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.search = new URLSearchParams({
    address: `${lookupStreet} ${houseNumber}, ${city}, Srbija`,
    components: "country:RS", language: "sr", key,
  }).toString();
  let body: { status?: string; results?: Result[] };
  try {
    const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error("HTTP error");
    body = await response.json();
  } catch {
    // Fetch errors can contain the credential-bearing URL. Never propagate it.
    throw new PickupGeocodingError("Servis za pronalaženje adrese trenutno nije dostupan. Pokušajte ponovo. Nalog nije poslat kuriru.");
  }
  if (body?.status === "ZERO_RESULTS") throw addressError(
    `Google Maps nije pronašao adresu ${quoted(`${street} ${houseNumber}, ${city}`)}.`,
    "Proverite ulicu, kućni broj i mesto u adresi porudžbine.",
  );
  if (["OVER_QUERY_LIMIT", "OVER_DAILY_LIMIT"].includes(body?.status ?? "")) {
    throw new PickupGeocodingError("Google Maps ne dozvoljava novu proveru zbog ograničenja kvote ili naplate. Administrator treba da proveri kvotu i naplatu Google Maps naloga. Nalog nije poslat kuriru.");
  }
  if (body?.status === "REQUEST_DENIED") {
    throw new PickupGeocodingError("Google Maps je odbio pristup servisu za proveru adrese. Administrator treba da proveri API ključ, dozvole i naplatu. Nalog nije poslat kuriru.");
  }
  if (body?.status !== "OK") {
    throw new PickupGeocodingError("Google Maps trenutno nije uspeo da proveri adresu. Pokušajte ponovo; ako se greška ponavlja, obratite se administratoru. Nalog nije poslat kuriru.");
  }
  const results = body.results;
  if (!Array.isArray(results) || !results.length) throw addressError("Google Maps nije vratio lokaciju adrese.", "Proverite ulicu, broj i mesto, pa pokušajte ponovo.");
  if (results.length === 1) return validatePickupResult(results[0], street, lookupStreet, houseNumber, city);
  const accepted = new Map<string, XExpressPickupCoordinates>();
  const reasons: string[] = [];
  for (const candidate of results) {
    try {
      const point = validatePickupResult(candidate, street, lookupStreet, houseNumber, city);
      accepted.set(`${point.latitude},${point.longitude}`, point);
    } catch (error) {
      if (!(error instanceof PickupGeocodingError)) throw error;
      reasons.push(error.message.replace(/^Lokacija preuzimanja nije pouzdano pronađena\. /, "").replace(/ Nalog nije poslat kuriru\.$/, ""));
    }
  }
  // Extra Google suggestions are harmless when exactly one complete, precise
  // building matches. Duplicate results at the identical point are one location.
  if (accepted.size === 1) return [...accepted.values()][0];
  throw addressError(
    `Google Maps je pronašao više mogućih lokacija, ali ${accepted.size ? "više objekata odgovara istoj adresi" : "nijedan rezultat nije potpuno potvrdio objekat"}.${!accepted.size && reasons.length ? ` ${[...new Set(reasons)].slice(0, 2).join(" ")}` : ""}`,
    "Proverite ulicu, broj i mesto ili unesite tačnu lokaciju objekta potvrđenu sa kupcem u polje „Potvrđena lokacija kupca“ na reklamaciji.",
  );
}

function validatePickupResult(result: Result, street: string, lookupStreet: string, houseNumber: string, city: string): XExpressPickupCoordinates {
  const components = result?.address_components;
  const location = result?.geometry?.location;
  if (!Array.isArray(components) || !components.every((c) => c && Array.isArray(c.types) && typeof c.long_name === "string" && typeof c.short_name === "string")) {
    throw addressError("Google Maps je vratio nepotpune podatke adrese.", "Pokušajte ponovo; ako se greška ponavlja, obratite se administratoru.");
  }
  const has = (type: string, expected: string) => components.some((c) => c.types.includes(type) && normalize(c.long_name) === normalize(expected));
  const found = (types: string[]) => components.find((c) => types.some((type) => c.types.includes(type)))?.long_name;
  if (!components.some((c) => c.types.includes("country") && c.short_name === "RS")) {
    throw addressError("Pronađena lokacija nije potvrđena kao adresa u Srbiji.", "Proverite mesto i ulicu u adresi porudžbine.");
  }
  if (!has("route", lookupStreet) && !components.some(c => c.types.includes("route") &&
      (samePickupStreet(c.long_name, lookupStreet, city) || samePickupStreet(c.short_name, lookupStreet, city)))) {
    const route = found(["route"]);
    throw addressError(
      route ? `U porudžbini je ulica ${quoted(street)}, a Google Maps je pronašao ${quoted(route)}.` : `Google Maps nije potvrdio ulicu ${quoted(street)}.`,
      "Proverite ulicu i izaberite odgovarajući naziv iz šifarnika; prikazani predlog nije automatski potvrđena adresa kupca.",
    );
  }
  if (!has("street_number", houseNumber)) {
    const number = found(["street_number"]);
    throw addressError(number ? `Unet je kućni broj ${quoted(houseNumber)}, a Google Maps je pronašao ${quoted(number)}.` : `Google Maps nije potvrdio kućni broj ${quoted(houseNumber)}.`,
      "Proverite tačan broj kod kupca i ispravite adresu porudžbine.");
  }
  const cityTypes = ["locality", "postal_town", "sublocality", "administrative_area_level_3"];
  if (!cityTypes.some((type) => has(type, city))) {
    const locality = found(cityTypes);
    throw addressError(locality ? `Uneto je mesto ${quoted(city)}, a Google Maps je pronašao ${quoted(locality)}.` : `Google Maps nije potvrdio mesto ${quoted(city)}.`,
      "Proverite mesto i ulicu u adresi porudžbine.");
  }
  if (result.partial_match) throw addressError("Google Maps je samo delimično prepoznao adresu.", "Proverite pun naziv ulice i kućni broj kod kupca.");
  if (!Array.isArray(result.types) || !result.types.some((t) => ["street_address", "premise", "subpremise"].includes(t))) {
    throw addressError("Google Maps je pronašao područje ili ulicu, ali nije potvrdio objekat za preuzimanje.", "Proverite kućni broj; ako objekat nije označen na mapi, unesite lokaciju objekta potvrđenu sa kupcem u polje „Potvrđena lokacija kupca“ na reklamaciji.");
  }
  if (result.geometry?.location_type !== "ROOFTOP") {
    throw addressError("Google Maps je prepoznao adresu, ali nije potvrdio tačnu lokaciju objekta.", "Proverite ulicu i broj; ako su tačni, unesite lokaciju objekta potvrđenu sa kupcem u polje „Potvrđena lokacija kupca“ na reklamaciji jer automatska provera nema dovoljnu preciznost.");
  }
  if (!location || !Number.isFinite(location.lat) || !Number.isFinite(location.lng) ||
      location.lat < 41.8 || location.lat > 46.3 || location.lng < 18.8 || location.lng > 23.1) {
    throw addressError("Google Maps je vratio nevažeću lokaciju ili lokaciju izvan podržanog područja Srbije.", "Proverite adresu; ako je tačna, obratite se administratoru.");
  }
  return { latitude: location.lat, longitude: location.lng };
}
