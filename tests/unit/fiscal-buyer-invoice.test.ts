import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findOrder: vi.fn(),
  upsertInvoice: vi.fn(),
  updateInvoice: vi.fn(),
  buildInvoicePdf: vi.fn(),
  resolveBuyer: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    order: { findUnique: mocks.findOrder },
    invoice: {
      upsert: mocks.upsertInvoice,
      update: mocks.updateInvoice,
      findUnique: vi.fn(),
    },
  },
}));
vi.mock("@/lib/email", () => ({
  loadOrderForEmail: vi.fn(),
  sendOrderConfirmation: vi.fn(),
}));
vi.mock("@/lib/email/pdf", () => ({
  buildInvoicePdf: mocks.buildInvoicePdf,
}));
vi.mock("@/lib/document-buyer", () => ({
  resolveOrderDocumentBuyerAddress: mocks.resolveBuyer,
}));
vi.mock("@/lib/env", () => ({ envValue: vi.fn(() => undefined) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

import { issueFiscalBuyerInvoiceForOrder } from "@/lib/receipts/buyer";

const issuedAt = new Date("2026-09-17T12:05:00.000Z");
const order = {
  id: "order-db-1",
  number: "26-000101",
  createdAt: new Date("2026-09-17T10:00:00.000Z"),
  updatedAt: new Date("2026-09-17T10:00:00.000Z"),
  status: "KREIRANO",
  paymentMethod: "UPLATA_NA_RACUN",
  guestEmail: "firma@example.rs",
  user: null,
  subtotal: 12_000,
  shipping: 0,
  assemblyTotal: 0,
  savings: 0,
  voucherCode: null,
  voucherDiscount: null,
  firstPurchaseDiscount: null,
  savedCardDiscount: null,
  total: 12_000,
  shipFirstName: "Petar",
  shipLastName: "Petrović",
  shipPhone: "0601234567",
  shipStreet: "Poslovna 1",
  shipPostalCode: "11000",
  shipCity: "Beograd",
  shipCompanyName: "Kupac doo",
  shipPib: "109876543",
  billingSameAsShipping: true,
  billFirstName: null,
  billLastName: null,
  billStreet: null,
  billPostalCode: null,
  billCity: null,
  billCompanyName: null,
  billPib: null,
  payments: [{ status: "PAID", createdAt: issuedAt }],
  invoices: [],
  items: [
    {
      id: "item-1",
      sku: "SKU-1",
      name: "Stolica",
      attribute1: null,
      qty: 1,
      unitPriceFull: 12_000,
      unitPriceSale: 12_000,
      withAssembly: false,
      assemblyPrice: null,
    },
  ],
};

describe("fiscal buyer invoice", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findOrder.mockResolvedValue(order);
    mocks.resolveBuyer.mockReturnValue({
      firstName: "Petar",
      lastName: "Petrović",
      street: "Poslovna 1",
      postalCode: "11000",
      city: "Beograd",
      companyName: "Kupac doo",
      pib: "109876543",
      source: "shipping",
    });
    mocks.buildInvoicePdf.mockResolvedValue(Buffer.from("buyer invoice"));
    mocks.upsertInvoice.mockResolvedValue({ id: "invoice-1", number: "R-26-000101" });
  });

  it("creates a separate BUYER_RECEIPT from the fiscal date and references", async () => {
    const result = await issueFiscalBuyerInvoiceForOrder(order.id, {
      issuedAt,
      fiscalReceiptNumbers: ["AB12/42"],
    });

    expect(result).toMatchObject({
      ok: true,
      issued: true,
      invoiceId: "invoice-1",
      number: "R-26-000101",
    });
    expect(mocks.buildInvoicePdf).toHaveBeenCalledWith(
      expect.objectContaining({ number: order.number }),
      {
        kind: "BUYER_RECEIPT",
        number: "R-26-000101",
        issuedAt,
        fiscalReceiptNumbers: ["AB12/42"],
      },
    );
    expect(mocks.upsertInvoice).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          orderId_kind: { orderId: order.id, kind: "BUYER_RECEIPT" },
        },
        create: expect.objectContaining({
          kind: "BUYER_RECEIPT",
          number: "R-26-000101",
          issuedAt,
        }),
      }),
    );
  });

  it("does not create the extra invoice for a physical person", async () => {
    mocks.resolveBuyer.mockReturnValue({
      firstName: "Petar",
      lastName: "Petrović",
      street: "Poslovna 1",
      postalCode: "11000",
      city: "Beograd",
      companyName: null,
      pib: null,
      source: "shipping",
    });

    await expect(
      issueFiscalBuyerInvoiceForOrder(order.id, {
        issuedAt,
        fiscalReceiptNumbers: ["AB12/42"],
      }),
    ).resolves.toEqual({ ok: true, issued: false });
    expect(mocks.buildInvoicePdf).not.toHaveBeenCalled();
    expect(mocks.upsertInvoice).not.toHaveBeenCalled();
  });
});
