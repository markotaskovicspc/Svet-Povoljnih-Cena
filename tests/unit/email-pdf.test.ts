import { describe, expect, it } from "vitest";
import {
  buildInvoicePdf,
  buildWithdrawalFormPdf,
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

describe("customer PDF documents", () => {
  it("renders the styled pro-forma as a branded A4 image PDF", async () => {
    const bytes = await buildInvoicePdf(order);
    const pdf = bytes.toString("binary");
    expect(pdf).toContain("/Subtype /Image");
    expect(pdf).toContain("/MediaBox [0 0 595 842]");
    expect(bytes.length).toBeGreaterThan(20_000);
  });

  it("leaves return quantities blank and tells the customer what to circle", () => {
    const pdf = buildWithdrawalFormPdf(order).toString("binary");
    expect(pdf).toContain("/Logo");
    expect(pdf).toContain("Zaokruzite artikal koji vracate");
    expect(pdf).toContain("Kolicina: __________");
    expect(pdf).not.toContain("2 x Stolica");
  });
});
