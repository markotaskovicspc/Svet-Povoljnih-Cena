export type WarehouseDetails = {
  name: string;
  address: string | null;
  city: string | null;
  email: string | null;
  phone: string | null;
};

const LIMITS = {
  name: 160,
  address: 240,
  city: 120,
  email: 254,
  phone: 40,
} as const;

function textValue(value: unknown) {
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim()
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

export function normalizeWarehouseName(value: unknown) {
  const name = textValue(value);
  if (!name) throw new Error("Naziv magacina je obavezan.");
  if (name.length > LIMITS.name) {
    throw new Error(`Naziv magacina može imati najviše ${LIMITS.name} karaktera.`);
  }
  return name;
}

export function normalizeWarehouseAddress(value: unknown) {
  return optionalText(value, "Adresa", LIMITS.address);
}

export function normalizeWarehouseCity(value: unknown) {
  return optionalText(value, "Mesto", LIMITS.city);
}

export function normalizeWarehouseEmail(value: unknown) {
  const email = optionalText(value, "E-mail", LIMITS.email)?.toLowerCase() ?? null;
  if (!email) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Unesite ispravnu e-mail adresu.");
  }
  return email;
}

export function normalizeWarehousePhone(value: unknown) {
  const phone = optionalText(value, "Telefon", LIMITS.phone);
  if (!phone) return null;
  if (!/^[+\d][\d\s()+./-]*$/.test(phone) || phone.replace(/\D/g, "").length < 6) {
    throw new Error("Unesite ispravan broj telefona.");
  }
  return phone;
}

export function normalizeWarehouseDetails(
  input: Record<string, unknown>,
): WarehouseDetails {
  return {
    name: normalizeWarehouseName(input.name),
    address: normalizeWarehouseAddress(input.address),
    city: normalizeWarehouseCity(input.city),
    email: normalizeWarehouseEmail(input.email),
    phone: normalizeWarehousePhone(input.phone),
  };
}
