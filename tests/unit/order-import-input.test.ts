import { describe, expect, it } from "vitest";
import { importOrderInputSchema, importValidationMessage, normalizeImportInput } from "@/lib/admin/order-import/input";

const input = {
  lines: [{ sku: "110071", qty: 2 }],
  shipping: { firstName: "Test", lastName: "Kupac", phone: "0600000000", street: "Test ulica", houseNumber: "35", city: "Niš", postalCode: "18000", country: "RS" },
  paymentMethod: "POUZECE_GOTOVINA", shippingMethod: "KURIR", consent: true,
};
const parse = (value: unknown) => importOrderInputSchema.safeParse(normalizeImportInput(value));
describe("screenshot order review validation", () => {
  it.each([undefined, "", "   "])("allows no email (%s) without fabricating one", guestEmail => {
    const result = parse({ ...input, guestEmail });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.guestEmail).toBeUndefined();
  });
  it.each(["test@@example.com", "test.gmail.com", "test@", "test @example.com"])("requires correction of invalid email %s", guestEmail => {
    const result = parse({ ...input, guestEmail });
    expect(result.success).toBe(false);
    if (!result.success) expect(importValidationMessage(result.error.issues).fields).toContain("guestEmail");
  });
  it("normalizes email spacing and case without changing its address", () => {
    expect(parse({ ...input, guestEmail: " QA@Example.COM " })).toMatchObject({ success: true, data: { guestEmail: "qa@example.com" } });
  });
  it.each(["060 000 0000", "+381 (60) 000-0000", "00381 60 0000000", "381600000000", "0111234567", "067123456"])("accepts a supported phone format: %s", phone => {
    expect(parse({ ...input, shipping: { ...input.shipping, phone } }).success).toBe(true);
  });
  it.each(["", "        ", "abcdefghij", "06012", "06012345678901", "0601234567 ili 0611234567", "+49 123456789", "0000000000"])("rejects missing or invalid phone: %s", phone => {
    expect(parse({ ...input, shipping: { ...input.shipping, phone } }).success).toBe(false);
  });
  it.each(["12", "12A", "8/6", "12-14", "bb", "b.b."])("preserves supported house number %s", houseNumber => {
    expect(parse({ ...input, shipping: { ...input.shipping, houseNumber } }).success).toBe(true);
  });
  it.each(["", "?", "nije navedeno", "0"])("does not invent a missing house number: %s", houseNumber => {
    expect(parse({ ...input, shipping: { ...input.shipping, street: "Bulevar 12. februara", houseNumber } }).success).toBe(false);
  });
  it.each([null, 0, -1, 1.5, 100])("rejects missing or invalid quantity %s", qty => {
    expect(parse({ ...input, lines: [{ sku: "110071", qty }] }).success).toBe(false);
  });
  it("rejects duplicate products instead of double-counting them silently", () => {
    const result = parse({ ...input, lines: [...input.lines, ...input.lines] });
    expect(result.success).toBe(false);
    if (!result.success) expect(importValidationMessage(result.error.issues).fields).toContain("sku");
  });
  it.each([null, [], "not an order", {}])("handles malformed requests (%j)", value => {
    expect(parse(value).success).toBe(false);
  });
});
