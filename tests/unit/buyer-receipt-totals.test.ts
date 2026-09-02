import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/email", () => ({
  loadOrderForEmail: vi.fn(),
  sendOrderConfirmation: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

import { buildReceiptSnapshot, orderToPdfInput } from "@/lib/receipts/buyer";

const money = (value: number) => new Prisma.Decimal(value);

const order = {
  id: "order-1",
  number: "SPC-2026-0001",
  createdAt: new Date("2026-08-20T10:00:00.000Z"),
  status: "CREATED",
  paymentMethod: "KARTICA",
  subtotal: money(2_000),
  savings: money(400),
  shipping: money(490),
  assemblyTotal: money(600),
  voucherCode: "TEST",
  voucherDiscount: money(100),
  firstPurchaseDiscount: money(150),
  savedCardDiscount: money(50),
  total: money(2_790),
  guestEmail: "kupac@example.com",
  shipFirstName: "Test",
  shipLastName: "Kupac",
  shipPhone: "+381600000000",
  shipStreet: "Test 1",
  shipPostalCode: "11000",
  shipCity: "Beograd",
  shipCompanyName: null,
  shipPib: null,
  billingSameAsShipping: true,
  billFirstName: null,
  billLastName: null,
  billStreet: null,
  billPostalCode: null,
  billCity: null,
  billCompanyName: null,
  billPib: null,
  items: [
    {
      sku: "SKU-1",
      name: "Test proizvod",
      attribute1: null,
      qty: 2,
      unitPriceFull: money(1_200),
      unitPriceSale: money(1_000),
      withAssembly: true,
      assemblyPrice: money(300),
    },
  ],
  payments: [{ status: "PAID" }],
  user: { email: "kupac@example.com" },
};

describe("buyer receipt totals", () => {
  it("keeps delivery and every order-level discount in regenerated PDFs and snapshots", () => {
    const pdfInput = orderToPdfInput(order as never);
    const snapshot = buildReceiptSnapshot(order as never, "kupac@example.com");

    expect(pdfInput).toMatchObject({
      shipping: 490,
      voucherDiscount: 100,
      firstPurchaseDiscount: 150,
      savedCardDiscount: 50,
      total: 2_790,
      shipping_address: {
        phone: "+381600000000",
        email: "kupac@example.com",
      },
    });
    expect(snapshot.order.totals).toEqual({
      subtotal: 2_000,
      shipping: 490,
      assemblyTotal: 600,
      savings: 400,
      voucherDiscount: 100,
      firstPurchaseDiscount: 150,
      savedCardDiscount: 50,
      total: 2_790,
    });
  });

  it("prefers the legal billing identity for a business buyer", () => {
    const pdfInput = orderToPdfInput({
      ...order,
      billingSameAsShipping: false,
      billFirstName: "Milan",
      billLastName: "Jovanović",
      billStreet: "Poslovna 12",
      billPostalCode: "21000",
      billCity: "Novi Sad",
      billCompanyName: "Kupac d.o.o.",
      billPib: "109876543",
    } as never);

    expect(pdfInput.billing_address).toEqual({
      firstName: "Milan",
      lastName: "Jovanović",
      street: "Poslovna 12",
      postalCode: "21000",
      city: "Novi Sad",
      phone: "+381600000000",
      email: "kupac@example.com",
      companyName: "Kupac d.o.o.",
      pib: "109876543",
    });
  });

  it("snapshots the same legal buyer that appears on the document", () => {
    const businessShippingOrder = {
      ...order,
      billingSameAsShipping: false,
      shipFirstName: "Darko",
      shipLastName: "Stanić",
      shipCompanyName: "DSF DOO",
      shipPib: "106986493",
      shipStreet: "Tihomira Vuksanovića 45",
      shipPostalCode: "34000",
      shipCity: "Kragujevac",
      billFirstName: "Iva",
      billLastName: "Stanić",
      billStreet: "Industrijska 17",
      billPostalCode: "34000",
      billCity: "Kragujevac",
      billCompanyName: null,
      billPib: null,
    };

    expect(
      buildReceiptSnapshot(
        businessShippingOrder as never,
        "kupac@example.com",
      ).order.customer,
    ).toMatchObject({
      firstName: "Darko",
      lastName: "Stanić",
      companyName: "DSF DOO",
      pib: "106986493",
      street: "Tihomira Vuksanovića 45",
      addressSource: "shipping",
    });
  });
});
