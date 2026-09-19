import { describe, expect, it } from "vitest";
import { contactTableFromRows, guessContactColumns, parseContactCsv, parsePastedContacts, prepareContactImport } from "@/lib/newsletter/import-parser";

const prepare = (value: string) => { const table = parsePastedContacts(value); return prepareContactImport(table, guessContactColumns(table.headers)); };
describe("custom contact lists", () => {
  it("prepares 70,000 pasted addresses and deduplicates case-insensitively", () => {
    const text = Array.from({ length: 70_000 }, (_, i) => `person${i}@example.com`).join("\n");
    const result = prepare(`${text}\nPERSON1@example.com\ninvalid-email`);
    expect(result).toMatchObject({ uniqueValid: 70_000, duplicateRows: 1, invalidRows: 1, withoutConsent: 70_000 });
  });
  it("preserves quoted CSV, Unicode, duplicate headers and every additional column", () => {
    const table = contactTableFromRows(parseContactCsv('email;Ime;Prezime;Grad;Grad;Napomena\nANA@example.com;Ana;Anić;Niš;Beograd;"red jedan\nred dva; sa separatorom"'));
    const result = prepareContactImport(table, guessContactColumns(table.headers));
    expect(result.contacts[0]).toMatchObject({ email: "ana@example.com", firstName: "Ana", lastName: "Anić", consented: false, customFields: { Grad: "Niš", "Grad (2)": "Beograd", Napomena: "red jedan\nred dva; sa separatorom" } });
  });
  it("lets users map unknown headers and retains headerless table data", () => {
    const table = parsePastedContacts("ana@example.com,Ana\nmarko@example.com,Marko");
    expect(prepareContactImport(table, { email: 0, firstName: 1 }).contacts[0].firstName).toBe("Ana");
    const custom = contactTableFromRows(parseContactCsv("Adresa primaoca,Nadimak\na@example.com,Ana"));
    expect(prepareContactImport(custom, { email: 0, firstName: 1 }).contacts[0].firstName).toBe("Ana");
  });
  it("accepts plain lists separated by spaces, commas and semicolons", () => {
    expect(prepare("a@example.com b@example.com,c@example.com;d@example.com").uniqueValid).toBe(4);
  });
  it("requires documented consent and never overrides a negative consent column", () => {
    const table = parsePastedContacts("email,consent\na@example.com,no\nb@example.com,yes");
    expect(() => prepareContactImport(table, { email: 0 }, { confirmed: true, source: "" })).toThrow("izvor");
    const result = prepareContactImport(table, guessContactColumns(table.headers), { confirmed: true, source: "Sajam 2026" });
    expect(result.contacts.map((row) => row.consented)).toEqual([false, true]);
    expect(prepareContactImport(parsePastedContacts("a@example.com"), { email: 0 }, { confirmed: true, source: "Sajam 2026" }).explicitConsent).toBe(1);
  });
  it("rejects too many contacts and malformed CSV", () => {
    expect(() => parsePastedContacts(Array.from({ length: 100_001 }, (_, i) => `p${i}@example.com`).join("\n"))).toThrow("100.000");
    expect(() => parseContactCsv('email,name\na@example.com,"unfinished')).toThrow("navodnike");
  });
});
