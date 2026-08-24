import { describe, expect, it } from "vitest";
import { previewNewsletterContactImport } from "@/lib/newsletter/contact-import";

describe("newsletter contact import", () => {
  it("activates only rows with explicit affirmative consent", async () => {
    const file = csvFile([
      "email,ime,prezime,consent,datum_saglasnosti,izvor",
      "ana@example.com,Ana,Anić,da,2026-08-20,stara-baza",
      "marko@example.com,Marko,Marković,,,stara-baza",
      "ana@example.com,Duplikat,Kontakt,yes,2026-08-21,stara-baza",
      "nije-email,Loš,Red,da,2026-08-21,stara-baza",
    ].join("\n"));

    await expect(previewNewsletterContactImport(file)).resolves.toMatchObject({
      totalRows: 4,
      uniqueValid: 2,
      explicitConsent: 1,
      withoutConsent: 1,
      invalidRows: 1,
      duplicateRows: 1,
      samples: [
        { email: "ana@example.com", status: "ACTIVE" },
        { email: "marko@example.com", status: "PENDING" },
      ],
    });
  });

  it("accepts semicolon-delimited Serbian headers", async () => {
    const file = csvFile([
      "mejl;ime;prezime;saglasnost;izvor",
      "kupac@example.com;Kupac;Primer;potvrđeno;prodavnica",
    ].join("\n"));

    await expect(previewNewsletterContactImport(file)).resolves.toMatchObject({
      uniqueValid: 1,
      explicitConsent: 1,
      invalidRows: 0,
    });
  });
});

function csvFile(content: string) {
  return new File([content], "kontakti.csv", { type: "text/csv" });
}
