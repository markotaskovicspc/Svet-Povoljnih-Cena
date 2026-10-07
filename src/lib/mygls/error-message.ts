import type { MyGlsParcel } from "./types";

/** Explain known provider validation errors without exposing the request/auth. */
export function myGlsErrorMessage(
  description: string,
  references: unknown = [],
  parcels: readonly MyGlsParcel[] = [],
) {
  const match = /^Invalid data in ['"]([^'"]+)['"]\.?$/i.exec(description);
  if (!match) return description;
  const field = match[1];
  const direction = field.startsWith("Delivery ") ? "DeliveryAddress"
    : field.startsWith("Pickup ") ? "PickupAddress" : null;
  if (!direction) return description;
  const fieldName = field.slice(direction === "DeliveryAddress" ? 9 : 7);
  const fields: Record<string, { key: string; label: string; instruction: string }> = {
    "Zip Code": { key: "ZipCode", label: "poštanski broj", instruction: "Proverite poštanski broj u GLS šifarniku za to mesto; broj iz šifarnika drugog kurira može da se razlikuje." },
    "City": { key: "City", label: "mesto", instruction: "Proverite mesto i pripadajući poštanski broj u GLS šifarniku." },
    "Street": { key: "Street", label: "ulicu", instruction: "Proverite pun naziv ulice u adresi." },
    "House Number": { key: "HouseNumber", label: "kućni broj", instruction: "Proverite i dopunite kućni broj u adresi." },
    "Name": { key: "Name", label: "ime / naziv", instruction: "Proverite ime ili naziv firme u adresi." },
    "Country Iso Code": { key: "CountryIsoCode", label: "oznaku države", instruction: "Proverite državu u adresi (RS za Srbiju)." },
    "Contact Phone": { key: "ContactPhone", label: "kontakt telefon", instruction: "Proverite kontakt telefon, uključujući pozivni broj države." },
    "Contact Email": { key: "ContactEmail", label: "kontakt email", instruction: "Proverite kontakt email u adresi." },
  };
  const rule = fields[fieldName];
  if (!rule) return description;
  const refs = Array.isArray(references) ? references.filter((r): r is string => typeof r === "string") : [];
  // Never guess which address failed when several parcels were submitted.
  const parcel = refs.length === 1 ? parcels.find(p => p.ClientReference === refs[0])
    : !refs.length && parcels.length === 1 ? parcels[0] : undefined;
  const address = parcel?.[direction];
  const value = address?.[rule.key as keyof typeof address];
  const context = typeof value === "string" ? ` „${value.slice(0, 120)}“` : "";
  const reference = refs.length === 1 ? ` za nalog ${refs[0].slice(0, 40)}` : "";
  return `GLS je odbio ${rule.label}${context} u adresi ${direction === "DeliveryAddress" ? "primaoca" : "preuzimanja"}${reference}. ${rule.instruction}`;
}
