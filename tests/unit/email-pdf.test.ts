import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildInvoicePdf,
  buildWithdrawalFormPdf,
  invoiceBuyerLines,
  withdrawalBuyerLines,
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
    phone: "0601234567",
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
    phone: "0601234567",
  },
};

const shippingBusinessWithPersonalBilling: InvoiceOrderInput = {
  ...order,
  shipping_address: {
    ...order.shipping_address,
    firstName: "Darko",
    lastName: "Stanić",
    companyName: "DSF DOO",
    pib: "106986493",
    street: "Tihomira Vuksanovića 45",
    postalCode: "34000",
    city: "Kragujevac",
  },
  billing_address: {
    firstName: "Iva",
    lastName: "Stanić",
    street: "Industrijska 17",
    postalCode: "34000",
    city: "Kragujevac",
  },
};

describe("customer PDF documents", () => {
  it("renders the styled pro-forma as a branded A4 image PDF", async () => {
    const bytes = await buildInvoicePdf(businessOrder);
    const pdf = bytes.toString("binary");
    expect(pdf).toContain("/Subtype /Image");
    expect(pdf).toContain("/MediaBox [0 0 595 842]");
    expect(bytes.length).toBeGreaterThan(20_000);
    expect(invoiceBuyerLines(order)).toContain("Telefon: 0601234567");
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
      "Tip kupca: Pravno lice",
      "Naziv firme: Kupac d.o.o.",
      "PIB: 109876543",
      "Kontakt osoba: Milan Jovanović",
      "Adresa: Poslovna 12, 21000 Novi Sad",
      "Telefon: 0601234567",
    ]);
  });

  it("keeps the shipping legal identity when a separate billing address is personal", () => {
    expect(invoiceBuyerLines(shippingBusinessWithPersonalBilling)).toEqual([
      "Tip kupca: Pravno lice",
      "Naziv firme: DSF DOO",
      "PIB: 106986493",
      "Kontakt osoba: Darko Stanić",
      "Adresa: Tihomira Vuksanovića 45, 34000 Kragujevac",
      "Telefon: 0601234567",
    ]);
    expect(withdrawalBuyerLines(shippingBusinessWithPersonalBilling)).toEqual([
      "Pravno lice: DSF DOO",
      "PIB: 106986493",
      "Kontakt osoba: Darko Stanić",
      "Adresa: Tihomira Vuksanovića 45, 34000 Kragujevac",
    ]);
  });

  it("includes every customer field shown in the admin overview", () => {
    expect(
      invoiceBuyerLines({
        ...shippingBusinessWithPersonalBilling,
        shipping_address: {
          ...shippingBusinessWithPersonalBilling.shipping_address,
          phone: "0603021060",
          email: "tehnickipregled@dsf.rs",
        },
      }),
    ).toEqual([
      "Tip kupca: Pravno lice",
      "Naziv firme: DSF DOO",
      "PIB: 106986493",
      "Kontakt osoba: Darko Stanić",
      "Adresa: Tihomira Vuksanovića 45, 34000 Kragujevac",
      "Telefon: 0603021060",
      "E-pošta: tehnickipregled@dsf.rs",
    ]);
  });

  it("adds the company, PIB and contact to the business return form", () => {
    expect(withdrawalBuyerLines(businessOrder)).toEqual([
      "Pravno lice: Kupac d.o.o.",
      "PIB: 109876543",
      "Kontakt osoba: Milan Jovanović",
      "Adresa: Poslovna 12, 21000 Novi Sad",
    ]);
    const pdf = buildWithdrawalFormPdf(businessOrder).toString("binary");
    expect(pdf).toContain("Pravno lice: Kupac d.o.o.");
    expect(pdf).toContain("PIB: 109876543");
  });
});
