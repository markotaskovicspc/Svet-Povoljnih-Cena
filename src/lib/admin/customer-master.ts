export type CustomerGenderValue = "NEPOZNATO" | "ZENSKI" | "MUSKI";

export type CustomerDetails = {
  fullName: string;
  firstName: string;
  lastName: string | null;
  address: string | null;
  city: string | null;
  postalCode: string | null;
  phone: string | null;
  email: string | null;
  gender: CustomerGenderValue;
};

const LIMITS = {
  name: 240,
  address: 240,
  city: 120,
  postalCode: 20,
  phone: 40,
  email: 254,
} as const;

// Male Serbian names that end in -a would otherwise match the common female-name rule.
const MALE_NAMES_ENDING_IN_A = new Set([
  "andreja",
  "andrija",
  "ilija",
  "isaija",
  "ivica",
  "jovica",
  "kosta",
  "luka",
  "matija",
  "nemanja",
  "nikola",
  "novica",
  "sava",
  "vukota",
  "zivota",
]);

// Common female names that do not end in -a.
const FEMALE_NAMES_NOT_ENDING_IN_A = new Set([
  "doris",
  "ines",
  "iris",
  "karmen",
  "merjem",
  "miriam",
  "nives",
]);

// These names are commonly used by more than one gender, so the name alone is inconclusive.
const AMBIGUOUS_NAMES = new Set(["sasa", "stasa", "vanja"]);

function textValue(value: unknown) {
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim().replace(/\s+/g, " ")
    : "";
}

function optionalText(value: unknown, label: string, maxLength: number) {
  const normalized = textValue(value);
  if (!normalized) return null;
  if (normalized.length > maxLength) {
    throw new Error(`${label} može imati najviše ${maxLength} karaktera.`);
  }
  return normalized;
}

function normalizedFirstName(value: unknown) {
  const firstToken = textValue(value).split(/[\s-]+/, 1)[0] ?? "";
  return firstToken
    .normalize("NFD")
    .replace(/[đĐ]/g, "dj")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("sr-Latn-RS")
    .replace(/[^a-z]/g, "");
}

/**
 * Deterministic Serbian-name heuristic used by the ERP customer base.
 * Ambiguous and missing first names intentionally remain unknown.
 */
export function inferCustomerGender(firstName: unknown): CustomerGenderValue {
  const normalized = normalizedFirstName(firstName);
  if (!normalized || AMBIGUOUS_NAMES.has(normalized)) return "NEPOZNATO";
  if (MALE_NAMES_ENDING_IN_A.has(normalized)) return "MUSKI";
  if (FEMALE_NAMES_NOT_ENDING_IN_A.has(normalized) || normalized.endsWith("a")) {
    return "ZENSKI";
  }
  return "MUSKI";
}

export function customerGenderLabel(gender: CustomerGenderValue) {
  if (gender === "ZENSKI") return "Ženski";
  if (gender === "MUSKI") return "Muški";
  return "Nepoznato";
}

export function normalizeCustomerName(value: unknown) {
  const fullName = textValue(value);
  if (!fullName) throw new Error("Ime i prezime kupca su obavezni.");
  if (fullName.length > LIMITS.name) {
    throw new Error(`Ime i prezime kupca mogu imati najviše ${LIMITS.name} karaktera.`);
  }

  const [firstName, ...lastNameParts] = fullName.split(" ");
  const lastName = lastNameParts.join(" ") || null;
  return {
    fullName,
    firstName,
    lastName,
    gender: inferCustomerGender(firstName),
  };
}

export function normalizeCustomerAddress(value: unknown) {
  return optionalText(value, "Adresa", LIMITS.address);
}

export function normalizeCustomerCity(value: unknown) {
  return optionalText(value, "Mesto", LIMITS.city);
}

export function normalizeCustomerPostalCode(value: unknown) {
  return optionalText(value, "Poštanski broj", LIMITS.postalCode);
}

export function normalizeCustomerPhone(value: unknown) {
  const phone = optionalText(value, "Telefon", LIMITS.phone);
  if (!phone) return null;
  if (!/^[+\d][\d\s()+./-]*$/.test(phone) || phone.replace(/\D/g, "").length < 6) {
    throw new Error("Unesite ispravan broj telefona.");
  }
  return phone;
}

export function normalizeCustomerEmail(value: unknown) {
  const email = optionalText(value, "E-mail", LIMITS.email)?.toLowerCase() ?? null;
  if (!email) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Unesite ispravnu e-mail adresu.");
  }
  return email;
}

export function normalizeCustomerDetails(
  input: Record<string, unknown>,
): CustomerDetails {
  return {
    ...normalizeCustomerName(input.name),
    address: normalizeCustomerAddress(input.address),
    city: normalizeCustomerCity(input.city),
    postalCode: normalizeCustomerPostalCode(input.postalCode),
    phone: normalizeCustomerPhone(input.phone),
    email: normalizeCustomerEmail(input.email),
  };
}
