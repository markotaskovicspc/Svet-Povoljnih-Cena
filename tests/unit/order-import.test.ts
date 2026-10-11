import { describe, expect, it } from "vitest";
import { exactImportProduct, importDraftSchema, importProductSearchTerms, withImportDefaults } from "@/lib/admin/order-import/schema";
import { signImportQuote, readImportQuote, type ImportQuote } from "@/lib/admin/order-import/quote";
import { allowedNavFor, applyAdminNavPreferences } from "@/lib/admin/nav";
const quote: ImportQuote = {
  actorId: "marko", expires: 20000, total: 998,
  input: { checkoutSessionId: "same-retry-12345", lines: [{ sku: "MOP", qty: 1 }], shipping: { firstName: "Selena", lastName: "Rasic", phone: "0652041082", street: "Lazara Arsenijevica", houseNumber: "2", city: "Jasenovik", postalCode: "18207", country: "RS" }, billingSameAsShipping: true, shippingMethod: "KURIR", paymentMethod: "POUZECE_GOTOVINA", consent: true },
};
describe("order import review", () => {
  it("requires an exact SKU or unique exact name before choosing a catalog item", () => {
    const candidates = [{ sku: "URBAN-W", name: "URBAN SEAT bela" }, { sku: "URBAN-B", name: "URBAN SEAT crna" }];
    expect(exactImportProduct({ name: "URBAN SEAT", sku: "", qty: 1, unitPrice: null }, candidates)).toBeNull();
    expect(exactImportProduct({ name: "URBAN SEAT", sku: "urban-w", qty: 1, unitPrice: null }, candidates)?.sku).toBe("URBAN-W");
    expect(exactImportProduct({ name: "URBAN SEAT bela", sku: "invented", qty: 1, unitPrice: null }, candidates)).toBeNull();
  });
  it("connects the real BAKE MASTER catalog title despite extra screenshot descriptions", () => {
    const line = { name: "Mini rerna BAKE MASTER 12 L, 1200 W", sku: "", qty: 1, unitPrice: null };
    expect(importProductSearchTerms(line.name)).toEqual(["bake", "master"]);
    expect(exactImportProduct(line, [{ sku: "210007", name: "Rerna BAKE MASTER" }])?.sku).toBe("210007");
    expect(exactImportProduct(line, [{ sku: "1", name: "Rerna BAKE MASTER" }, { sku: "2", name: "Rerna BAKE MASTER" }])).toBeNull();
    expect(exactImportProduct(line, [{ sku: "1", name: "Rerna BAKE MASTER 18L" }])).toBeNull();
    expect(exactImportProduct(line, [{ sku: "1", name: "Rerna" }])).toBeNull();
  });
  it("ignores punctuation and spacing in units without losing variant differences", () => {
    const line = { name: "Rerna BAKE MASTER 12 L, 1200 W", sku: "", qty: 1, unitPrice: null };
    const candidates = [{ sku: "12", name: "Rerna BAKE MASTER, 12L / 1200W" }, { sku: "18", name: "Rerna BAKE MASTER 18L 1200W" }];
    expect(exactImportProduct(line, candidates)?.sku).toBe("12");
  });
  it("defaults missing payment and shipping while preserving explicit agreements", () => {
    const missing = { paymentMethod: "", shippingMethod: "" } as Parameters<typeof withImportDefaults>[0];
    expect(withImportDefaults(missing)).toMatchObject({ paymentMethod: "POUZECE_GOTOVINA", shippingMethod: "KURIR" });
    expect(withImportDefaults({ ...missing, paymentMethod: "UPLATA_NA_RACUN", shippingMethod: "KAMION" })).toMatchObject({ paymentMethod: "UPLATA_NA_RACUN", shippingMethod: "KAMION" });
  });
  it("rejects malformed model output and keeps missing information explicit", () => {
    expect(importDraftSchema.safeParse({ lines: [{ sku: "MOP", qty: -1 }] }).success).toBe(false);
  });
  it("binds the reviewed order to the operator and preserves retry identity and customer postal code", () => {
    const token = signImportQuote(quote, "secret");
    const read = readImportQuote(token, "secret", "marko", 10000);
    expect(read.input.shipping.postalCode).toBe("18207");
    expect(read.input.checkoutSessionId).toBe("same-retry-12345");
    expect(() => readImportQuote(token, "secret", "another-admin", 10000)).toThrow();
    expect(() => readImportQuote(token, "secret", "marko", 30000)).toThrow();
  });
  it("rejects changes to the reviewed amount or address", () => {
    const token = signImportQuote(quote, "secret");
    const [, signature] = token.split(".");
    const changed = Buffer.from(JSON.stringify({ ...quote, total: 1 })).toString("base64url");
    expect(() => readImportQuote(`${changed}.${signature}`, "secret", "marko", 10000)).toThrow();
  });
  it("shows the new tab in older saved operator menus without exposing it to content editors", () => {
    const prefs = { visibleHrefs: ["/admin"], order: ["/admin"] };
    expect(applyAdminNavPreferences(allowedNavFor("OPS"), prefs).flatMap(g => g.items).some(i => i.href === "/admin/erp/porudzbina-iz-chata")).toBe(true);
    expect(allowedNavFor("CONTENT").flatMap(g => g.items).some(i => i.href === "/admin/erp/porudzbina-iz-chata")).toBe(false);
  });
});
