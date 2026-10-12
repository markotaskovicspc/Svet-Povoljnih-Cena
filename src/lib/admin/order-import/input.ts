import { channelOrderSchema } from "@/lib/checkout/order-schema";

/** Clean formatting, never fill in facts the customer did not supply. */
export function normalizeImportInput(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const input = value as Record<string, unknown>;
  const ship = input.shipping;
  let shipping = ship;
  if (ship && typeof ship === "object" && !Array.isArray(ship)) {
    shipping = Object.fromEntries(Object.entries(ship).map(([key, v]) => [key, typeof v === "string" ? v.trim().replace(/\s+/g, " ") : v]));
    const address = shipping as Record<string, unknown>;
    if (typeof address.phone === "string" && /^[+\d\s()./-]*$/.test(address.phone)) {
      let digits = address.phone.replace(/\D/g, "");
      if (digits.startsWith("00381")) digits = `0${digits.slice(5)}`;
      else if (digits.startsWith("381")) digits = `0${digits.slice(3)}`;
      address.phone = digits;
    }
  }
  return { ...input, shipping, ...(typeof input.guestEmail === "string" ? { guestEmail: input.guestEmail.trim().toLowerCase() || undefined } : {}) };
}

export const importOrderInputSchema = channelOrderSchema.superRefine((input, context) => {
  // Includes Serbian landlines and the extended 067 range accepted by the courier.
  if (!/^(0[1-9]\d{7,8}|067\d{6,8})$/.test(input.shipping.phone)) {
    context.addIssue({ code: "custom", path: ["shipping", "phone"], message: "Unesite jedan ispravan broj telefona u Srbiji." });
  }
});

export function importValidationMessage(issues: readonly { path: readonly PropertyKey[] }[]) {
  const labels: Record<string, string> = { firstName: "ime", lastName: "prezime", phone: "telefon", street: "ulica", houseNumber: "kućni broj (npr. 12, 12A, 8/6 ili bb)", city: "mesto", postalCode: "poštanski broj (5 cifara)", guestEmail: "e-pošta (ispravite je ili ostavite prazno)", paymentMethod: "plaćanje", shippingMethod: "dostava", sku: "artikal", qty: "količina (ceo broj od 1 do 99)", lines: "najmanje jedan artikal" };
  const fields = [...new Set(issues.map(i => String(i.path.at(-1))))];
  return { error: "Proverite ili dopunite: " + fields.map(key => labels[key] ?? "podatke porudžbine").join(", ") + ".", fields };
}
