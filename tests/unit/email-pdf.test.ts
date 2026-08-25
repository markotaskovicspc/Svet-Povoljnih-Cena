import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildInvoicePdf,
  buildWithdrawalFormPdf,
  invoiceBuyerLines,
  type InvoiceOrderInput,
} from "@/lib/email/pdf";

const order: InvoiceOrderInput = {
  number: "SPC-2026-TEST",
  createdAt: new Date("2026-08-18T00:00:00.000Z"),
  items: [
    { sku: "SKU-1", name: "Stolica", qty: 2, unitPriceSale: 1_200 },
    { sku: "SKU-2", name: "Sto", qty: 1, unitPriceSale: 4_000 },
  ],
  subtotal: 6_400,
  shipping: 390,
  assemblyTotal: 0,
  voucherCode: "TEST",
  voucherDiscount: 100,
  firstPurchaseDiscount: 150,
  savedCardDiscount: 50,
  total: 6_490,
  paymentMethod: "Pouzeće",
  shipping_address: {
    firstName: "Petar",
    lastName: "Petrović",
    street: "Glavna 1",
    postalCode: "11000",
    city: "Beograd",
  },
};

const businessOrder: InvoiceOrderInput = {
  ...order,
  billing_address: {
    firstName: "Milan",
    lastName: "Jovanović",
    companyName: "Kupac d.o.o.",
    pib: "109876543",
    street: "Poslovna 12",
    postalCode: "21000",
    city: "Novi Sad",
  },
};

describe("customer PDF documents", () => {
  it("renders the styled pro-forma as a branded A4 image PDF", async () => {
    const bytes = await buildInvoicePdf(businessOrder);
    const pdf = bytes.toString("binary");
    expect(pdf).toContain("/Subtype /Image");
    expect(pdf).toContain("/MediaBox [0 0 595 842]");
    expect(bytes.length).toBeGreaterThan(20_000);
    if (process.env.INVOICE_PDF_SAMPLE_PATH) {
      writeFileSync(process.env.INVOICE_PDF_SAMPLE_PATH, bytes);
    }
  });

  it("numbers each withdrawal item so the buyer can circle it", () => {
    const bytes = buildWithdrawalFormPdf(order);
    const pdf = bytes.toString("binary");

    expect(pdf.startsWith("%PDF-1.4")).toBe(true);
    expect(pdf).toContain("/MediaBox [0 0 595 842]");
    expect(pdf).toContain("Zaokruzite redni broj artikla");
    expect(pdf).toContain("\\(1\\) Stolica \\(SKU-1\\)");
    expect(pdf).toContain("\\(2\\) Sto \\(SKU-2\\)");
    expect(pdf).not.toContain("\\(   \\)");
  });

  it("formats order dates in the Belgrade business timezone", () => {
    const lateOrder = {
      ...order,
      createdAt: new Date("2026-08-20T22:30:00.000Z"),
    };

    expect(buildWithdrawalFormPdf(lateOrder).toString("binary")).toContain(
      "Datum porudzbine: 21.08.2026.",
    );
  });

  it("renders the billing company and its PIB as the buyer", () => {
    expect(
      invoiceBuyerLines(businessOrder),
    ).toEqual([
      "Kupac d.o.o.",
      "PIB: 109876543",
      "Kontakt: Milan Jovanović",
      "Poslovna 12, 21000 Novi Sad",
    ]);
  });
});
