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
  total: 6_790,
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
  it("brands the pro-forma with the same shared document header", () => {
    const pdf = buildInvoicePdf(order).toString("binary");
    expect(pdf).toContain("/Logo");
    expect(pdf).toContain("Predracun / racun");
    expect(pdf).toContain("Ukupno za uplatu");
  });

  it("leaves return quantities blank and tells the customer what to circle", () => {
    const pdf = buildWithdrawalFormPdf(order).toString("binary");
    expect(pdf).toContain("/Logo");
    expect(pdf).toContain("Zaokruzite artikal koji vracate");
    expect(pdf).toContain("Kolicina: __________");
    expect(pdf).not.toContain("2 x Stolica");
  });
});
