const HOUSE_NUMBER_PATTERN =
  /^(?:bb|[1-9]\d*[\p{L}]?(?:[/-][\p{L}\d]+)*)$/iu;

export const HOUSE_NUMBER_ERROR =
  "Unesite ceo kućni broj (npr. 12, 12A, 12/3, 12-14) ili bb.";

function cleanWhitespace(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function normalizeHouseNumber(value: unknown) {
  const compact = String(value ?? "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/^b\.b\.$/i, "bb");
  return /^bb$/i.test(compact) ? "bb" : compact;
}

export function isValidHouseNumber(value: unknown) {
  const normalized = normalizeHouseNumber(value);
  return normalized.length <= 20 && HOUSE_NUMBER_PATTERN.test(normalized);
}

export type SplitAddress = {
  street: string;
  houseNumber: string | null;
};

/**
 * Splits both the new canonical `Ulica (12A)` format and old saved values such
 * as `Ulica 12A`. When an explicit house number exists it is authoritative,
 * which prevents numbers that belong to a street name from being stripped.
 */
export function splitStreetAndHouseNumber(
  value: string,
  explicitHouseNumber?: string | null,
): SplitAddress {
  const normalizedStreet = cleanWhitespace(value);
  const explicit = normalizeHouseNumber(explicitHouseNumber);

  if (explicit && isValidHouseNumber(explicit)) {
    const escaped = escapeRegExp(explicit);
    const withoutCanonical = normalizedStreet.replace(
      new RegExp(`\\s*\\(${escaped}\\)\\s*$`, "iu"),
      "",
    );
    const withoutLegacy = withoutCanonical.replace(
      new RegExp(`(?:,|\\s)+${escaped}\\s*$`, "iu"),
      "",
    );
    return {
      street: cleanWhitespace(withoutLegacy).replace(/,$/, "").trim(),
      houseNumber: explicit,
    };
  }

  const canonical = normalizedStreet.match(/^(.*?)\s*\(([^()]*)\)\s*$/u);
  const canonicalNumber = normalizeHouseNumber(canonical?.[2]);
  if (canonical?.[1] && isValidHouseNumber(canonicalNumber)) {
    return {
      street: cleanWhitespace(canonical[1]).replace(/,$/, "").trim(),
      houseNumber: canonicalNumber,
    };
  }

  const legacy = normalizedStreet.match(
    /^(.*?)(?:,|\s)+((?:bb|b\.b\.|[1-9]\d*[\p{L}]?(?:[/-][\p{L}\d]+)*))\s*$/iu,
  );
  const legacyNumber = normalizeHouseNumber(legacy?.[2]);
  if (legacy?.[1] && isValidHouseNumber(legacyNumber)) {
    return {
      street: cleanWhitespace(legacy[1]).replace(/,$/, "").trim(),
      houseNumber: legacyNumber,
    };
  }

  return { street: normalizedStreet, houseNumber: null };
}

export function formatStreetAddress(street: string, houseNumber: string) {
  const split = splitStreetAndHouseNumber(street, houseNumber);
  if (!split.street || !split.houseNumber) return cleanWhitespace(street);
  return `${split.street} (${split.houseNumber})`;
}

export type CourierAddressParts = {
  street: string;
  displayStreet: string;
  originalHouseNumber: string;
  providerHouseNumber: string;
  providerHouseNumberInfo: string | null;
};

/**
 * Courier APIs receive an integer house number. The exact customer-entered
 * notation is retained in the street/description while suffixes are also
 * supplied as provider metadata where the provider supports it.
 */
export function courierAddressParts(
  street: string,
  explicitHouseNumber?: string | null,
): CourierAddressParts | null {
  const split = splitStreetAndHouseNumber(street, explicitHouseNumber);
  if (!split.houseNumber || !isValidHouseNumber(split.houseNumber)) return null;

  const original = normalizeHouseNumber(split.houseNumber);
  if (original === "bb") {
    return {
      street: split.street,
      displayStreet: `${split.street} (bb)`,
      originalHouseNumber: "bb",
      providerHouseNumber: "1",
      providerHouseNumberInfo: "bb",
    };
  }

  const match = original.match(/^([1-9]\d*)(.*)$/u);
  if (!match) return null;
  return {
    street: split.street,
    displayStreet: `${split.street} (${original})`,
    originalHouseNumber: original,
    providerHouseNumber: match[1]!,
    providerHouseNumberInfo: match[2] || null,
  };
}
