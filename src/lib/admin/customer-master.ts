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

export type CustomerMasterDetails = CustomerDetails & {
  customerType: "PERSON" | "COMPANY";
  companyName: string | null;
  pib: string | null;
  registrationNumber: string | null;
  country: string;
};

const LIMITS = {
  name: 240,
  companyName: 240,
  pib: 32,
  registrationNumber: 32,
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

export function normalizeCustomerCompanyName(value: unknown) {
  const companyName = optionalText(value, "Naziv firme", LIMITS.companyName);
  if (!companyName) throw new Error("Naziv firme je obavezan.");
  return companyName;
}

export function normalizeCustomerPib(value: unknown, required = false) {
  const pib = optionalText(value, "PIB", LIMITS.pib);
  if (!pib) {
    if (required) throw new Error("PIB firme je obavezan.");
    return null;
  }
  if (!/^[A-Za-z0-9./-]{5,32}$/.test(pib)) {
    throw new Error("PIB mora imati 5–32 slova, cifre ili znakove . / -.");
  }
  return pib.toUpperCase();
}

export function normalizeCustomerRegistrationNumber(
  value: unknown,
  required = false,
) {
  const registrationNumber = optionalText(
    value,
    "Matični broj",
    LIMITS.registrationNumber,
  );
  if (!registrationNumber) {
    if (required) throw new Error("Matični broj firme je obavezan.");
    return null;
  }
  if (!/^[A-Za-z0-9./-]{5,32}$/.test(registrationNumber)) {
    throw new Error("Matični broj mora imati 5–32 slova, cifre ili znakove . / -.");
  }
  return registrationNumber.toUpperCase();
}

export function normalizeCustomerCountry(value: unknown) {
  const country = textValue(value).toUpperCase() || "RS";
  if (!/^[A-Z]{2}$/.test(country)) {
    throw new Error("Država mora biti ISO oznaka od dva slova, na primer RS.");
  }
  return country;
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

export function normalizeCustomerMasterDetails(
  input: Record<string, unknown>,
): CustomerMasterDetails {
  if (input.customerType !== "Fizičko lice" && input.customerType !== "Firma") {
    throw new Error("Izaberite vrstu kupca.");
  }

  const customerType = input.customerType === "Firma" ? "COMPANY" : "PERSON";
  const common = {
    address: normalizeCustomerAddress(input.address),
    city: normalizeCustomerCity(input.city),
    postalCode: normalizeCustomerPostalCode(input.postalCode),
    phone: normalizeCustomerPhone(input.phone),
    email: normalizeCustomerEmail(input.email),
    country: normalizeCustomerCountry(input.country),
  };

  if (customerType === "COMPANY") {
    const companyName = normalizeCustomerCompanyName(input.name);
    if (!common.address || !common.city || !common.postalCode) {
      throw new Error(
        "Adresa, mesto i poštanski broj firme su obavezni za otpremnice.",
      );
    }
    return {
      customerType,
      fullName: companyName,
      firstName: "",
      lastName: null,
      companyName,
      pib: normalizeCustomerPib(input.pib, true),
      registrationNumber: normalizeCustomerRegistrationNumber(
        input.registrationNumber,
        true,
      ),
      gender: "NEPOZNATO",
      ...common,
    };
  }

  return {
    customerType,
    ...normalizeCustomerName(input.name),
    companyName: null,
    pib: null,
    registrationNumber: null,
    ...common,
  };
}
