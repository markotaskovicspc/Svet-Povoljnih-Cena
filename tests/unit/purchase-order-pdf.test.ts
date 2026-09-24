import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildPurchaseOrderPdf, purchaseOrderPageSvg } from "@/lib/admin/po-pdf";

describe("purchase-order PDF", () => {
  it("builds the bilingual landscape order-request PDF", async () => {
    const pdf = await buildPurchaseOrderPdf({
      number: "E2E-1/26",
      orderDate: new Date("2026-07-16T00:00:00Z"),
      currency: "RSD",
      totalPrice: 25_000,
      totalVolume: 2.5,
      parity: "FOB",
      loadingDate: new Date("2026-08-01T00:00:00Z"),
      loadingLocation: { name: "Ningbo" },
      supplier: {
        name: "Test dobavljač",
        address: "Industrijska 1",
        city: "Beograd",
        country: "Srbija",
        paymentTerms: "30% avans, 70% po utovaru",
      },
      items: [
        {
          sku: "SKU-1",
          name: "Test stolica",
          supplierProductName: "CHAIR-1",
          pattern: "siva / grey",
          packQty: 1,
          qty: 2,
          purchasePrice: 5_000,
          totalVolume: 0.5,
          certificates: "CE",
          barcode: "860000000001",
        },
        {
          sku: "SKU-2",
          name: "Test sto",
          supplierProductName: "TABLE-2",
          pattern: "crna / black",
          packQty: 1,
          qty: 1,
          purchasePrice: 15_000,
          totalVolume: 2,
          certificates: "CE, FSC",
          barcode: "860000000002",
        },
      ],
    });
    expect(pdf.subarray(0, 8).toString()).toBe("%PDF-1.4");
    expect(pdf.length).toBeGreaterThan(1_000);
    if (process.env.PO_PDF_SAMPLE_PATH) {
      writeFileSync(process.env.PO_PDF_SAMPLE_PATH, pdf);
    }
  });

  it("builds a valid multi-page PDF for long and XML-sensitive article data", async () => {
    const pdf = await buildPurchaseOrderPdf({
      number: "QA & 14/26",
      orderDate: new Date("2026-08-23T12:00:00Z"),
      currency: "EUR",
      totalPrice: 9_876.54,
      totalVolume: 12.345,
      parity: "DAP <Beograd>",
      notes: 'Napomena sa & < > " znakovima',
      supplier: {
        name: "Dobavljač & partner",
        address: "Industrijska 1",
        city: "Beograd",
        country: "Srbija",
        paymentTerms: "30% avans & 70% pre utovara",
      },
      loadingLocation: { name: "Luka <Ningbo>", city: "Ningbo" },
      items: Array.from({ length: 8 }, (_, index) => ({
        sku: `QA-${index + 1}`,
        name: `Dugačak naziv artikla & posebni znakovi <${index + 1}>`,
        supplierProductName: `SUP-${index + 1}`,
        attributes: 'Masiv & metal "premium"',
        pattern: "Crna & bela",
        packQty: 2,
        qty: index + 1,
        purchasePrice: 123.45 + index,
        currency: "EUR",
        totalVolume: 0.25 * (index + 1),
        certificates: "CE & FSC",
        barcode: `86000000000${index}`,
      })),
    });

    const binary = pdf.toString("binary");
    expect(pdf.subarray(0, 8).toString()).toBe("%PDF-1.4");
    expect(pdf.subarray(-6).toString()).toBe("%%EOF\n");
    expect(binary.match(/\/Type \/Page /g)).toHaveLength(2);
    expect(binary).toContain("/Count 2");

    if (process.env.PO_PDF_SAMPLE_PATH) {
      writeFileSync(process.env.PO_PDF_SAMPLE_PATH, pdf);
    }
  });
});

it("shows supplier, buyer and terms only on the first page, with repeated column headings", () => {
  const item = { sku: "TEST-1", name: "Stolica", qty: 1, purchasePrice: 100, totalVolume: 0.5, imageDataUri: null };
  const order = { number: "QA-33", orderDate: new Date("2026-09-24"), currency: "RSD", totalPrice: 100, totalVolume: 0.5, supplier: { name: "TEST SUPPLIER", address: "ADRESA", city: "GRAD", country: "RS", paymentTerms: "AVANS" }, items: [item] };
  const first = purchaseOrderPageSvg(order, [item], 0, 2);
  const continuation = purchaseOrderPageSvg(order, [item], 1, 2);
  expect(first).toContain("TEST SUPPLIER"); expect(first).toContain("AVANS");
  expect(continuation).not.toContain("TEST SUPPLIER"); expect(continuation).not.toContain("AVANS"); expect(continuation).not.toContain("PIB kupca");
  expect(continuation).toContain("TEST-1"); expect(continuation).toContain("SPC item"); expect(continuation).toContain("Strana / Page 2/2");
});
