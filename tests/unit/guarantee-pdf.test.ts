import { describe, expect, it } from "vitest";
import { writeFile } from "node:fs/promises";
import {
  buildGuaranteePdf,
  GUARANTEE_PROVIDER,
  GUARANTEE_TERM_TEXT,
  guaranteeBuyerLines,
  guaranteeItemsForOrder,
} from "@/lib/email/guarantee-pdf";

describe("guarantee PDF", () => {
  it("uses the one-year term stated in the client comments", () => {
    expect(GUARANTEE_TERM_TEXT).toBe("1 (jedna) godina");
  });

  it("uses the current legal identity from the invoice", () => {
    expect(GUARANTEE_PROVIDER).toEqual({
      name: "SVET POVOLJNIH CENA DOO BEOGRAD (NOVI BEOGRAD)",
      address: "Jurija Gagarina 32, 11070 Novi Beograd",
      pib: "115085587",
      reclamationsEmail: "reklamacije@svetpovoljnihcena.rs",
    });
  });

  it("adds company identity and PIB for a business buyer", () => {
    expect(
      guaranteeBuyerLines({
        firstName: "Milan",
        lastName: "Jovanović",
        companyName: "Kupac d.o.o.",
        pib: "109876543",
        street: "Poslovna 12",
        postalCode: "21000",
        city: "Novi Sad",
      }),
    ).toEqual([
      "Kupac d.o.o.",
      "PIB: 109876543",
      "Kontakt: Milan Jovanović",
      "Poslovna 12, 21000 Novi Sad",
    ]);
  });

  it("keeps every non-Rabalux item and excludes Rabalux", () => {
    expect(
      guaranteeItemsForOrder([
        orderItem("SPC-1", "SPC"),
        orderItem("RAB-1", "RABALUX"),
        orderItem("RAB-2", "  rabalux  "),
        orderItem("OWN-1"),
      ]).map((item) => item.sku),
    ).toEqual(["SPC-1", "OWN-1"]);
  });

  it("renders the supplied one-page layout as a valid PDF image page", async () => {
    const pdf = await buildGuaranteePdf({
      number: "SPC-2026-0001",
      createdAt: new Date("2026-08-15T10:00:00.000Z"),
      items: [
        {
          sku: "100001",
          name: "Test proizvod",
          qty: 2,
          categoryName: "Baštenski nameštaj",
          supplierIntegrationKey: "SPC",
        },
      ],
      buyer: {
        firstName: "Milan",
        lastName: "Jovanović",
        companyName: "Kupac d.o.o.",
        pib: "109876543",
        street: "Poslovna 12",
        postalCode: "21000",
        city: "Novi Sad",
      },
    });

    expect(pdf.subarray(0, 8).toString("binary")).toBe("%PDF-1.4");
    expect(pdf.length).toBeGreaterThan(50_000);
    expect(pdf.toString("binary")).toContain("/Count 1");

    if (process.env.GUARANTEE_PDF_SAMPLE_PATH) {
      await writeFile(process.env.GUARANTEE_PDF_SAMPLE_PATH, pdf);
    }
  });

  it("paginates a large order without dropping the document", async () => {
    const pdf = await buildGuaranteePdf({
      number: "SPC-2026-MULTIPAGE",
      createdAt: new Date("2026-08-15T10:00:00.000Z"),
      items: Array.from({ length: 24 }, (_, index) => ({
        sku: `LONG-SKU-${String(index + 1).padStart(2, "0")}`,
        name: `Dugačak naziv proizvoda broj ${index + 1} sa dodatnim opisom modela`,
        qty: (index % 3) + 1,
        categoryName: index === 0 ? "" : "Baštenski nameštaj i oprema",
        supplierIntegrationKey: "SPC",
      })),
    });

    const pageCount = Number(pdf.toString("binary").match(/\/Count (\d+)/)?.[1] ?? 0);
    expect(pageCount).toBeGreaterThan(1);
    expect(pdf.length).toBeGreaterThan(100_000);
  });
});

function orderItem(sku: string, supplierIntegrationKey?: string) {
  return {
    sku,
    name: `Artikal ${sku}`,
    qty: 1,
    unitPriceFull: 100,
    unitPriceSale: 100,
    categoryName: "Kategorija",
    supplierIntegrationKey,
  };
}
