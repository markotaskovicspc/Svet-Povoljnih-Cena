import "server-only";
import { splitStreetAndHouseNumber } from "./house-number";
import type { XExpressPickupCoordinates } from "@/lib/x-express/return";

export type PickupAddress = {
  shipStreet: string;
  shipHouseNumber?: string | null;
  shipCity: string;
};

export class PickupGeocodingError extends Error {}

const ADDRESS_ERROR = "Lokacija preuzimanja nije pouzdano pronađena. Proverite ulicu, kućni broj i mesto u adresi porudžbine, pa pokušajte ponovo. Nalog nije poslat kuriru.";
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
  if (!street || !houseNumber || houseNumber === "bb" || !city) {
    throw new PickupGeocodingError(ADDRESS_ERROR);
  }
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.search = new URLSearchParams({
    address: `${street} ${houseNumber}, ${city}, Srbija`,
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
  if (body?.status === "ZERO_RESULTS") throw new PickupGeocodingError(ADDRESS_ERROR);
  if (body?.status !== "OK") {
    throw new PickupGeocodingError("Google Maps nije odobrio proveru adrese. Administrator treba da proveri API ključ, naplatu i kvotu. Nalog nije poslat kuriru.");
  }
  const results = body.results;
  if (!Array.isArray(results) || results.length !== 1) throw new PickupGeocodingError(ADDRESS_ERROR);
  const result = results[0];
  const components = result?.address_components;
  const location = result?.geometry?.location;
  if (!Array.isArray(components) || !components.every((c) => c && Array.isArray(c.types) && typeof c.long_name === "string" && typeof c.short_name === "string")) {
    throw new PickupGeocodingError(ADDRESS_ERROR);
  }
  const has = (type: string, expected: string) => components.some((c) => c.types.includes(type) && normalize(c.long_name) === normalize(expected));
  if (result.partial_match || result.geometry?.location_type !== "ROOFTOP" ||
      !Array.isArray(result.types) || !result.types.some((t) => ["street_address", "premise", "subpremise"].includes(t)) ||
      !components.some((c) => c.types.includes("country") && c.short_name === "RS") ||
      !has("route", street) || !has("street_number", houseNumber) ||
      !["locality", "postal_town", "sublocality", "administrative_area_level_3"].some((type) => has(type, city)) ||
      !location || !Number.isFinite(location.lat) || !Number.isFinite(location.lng) ||
      location.lat < 41.8 || location.lat > 46.3 || location.lng < 18.8 || location.lng > 23.1) {
    throw new PickupGeocodingError(ADDRESS_ERROR);
  }
  return { latitude: location.lat, longitude: location.lng };
}
