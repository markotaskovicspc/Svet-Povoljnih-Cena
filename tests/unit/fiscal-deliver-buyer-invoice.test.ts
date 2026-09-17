import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  issueFiscalSale: vi.fn(),
  isOrderFullyFiscalized: vi.fn(),
  getIssuedSaleDocumentsForOrder: vi.fn(),
  loadOrderForEmail: vi.fn(),
  sendFiscalReceipt: vi.fn(),
  buildFiscalReceiptPdf: vi.fn(),
  buildWithdrawalFormPdf: vi.fn(),
  issueFiscalBuyerInvoiceForOrder: vi.fn(),
  markFiscalBuyerInvoiceEmailStatus: vi.fn(),
  updateMany: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: { fiscalDocument: { updateMany: mocks.updateMany } },
}));
vi.mock("@/lib/email", () => ({
  loadOrderForEmail: mocks.loadOrderForEmail,
  sendFiscalReceipt: mocks.sendFiscalReceipt,
}));
vi.mock("@/lib/email/pdf", () => ({
  buildWithdrawalFormPdf: mocks.buildWithdrawalFormPdf,
}));
vi.mock("@/lib/receipts", () => ({
  issueFiscalBuyerInvoiceForOrder: mocks.issueFiscalBuyerInvoiceForOrder,
  markFiscalBuyerInvoiceEmailStatus: mocks.markFiscalBuyerInvoiceEmailStatus,
}));
vi.mock("@/lib/fiscal/issue", () => ({
  issueFiscalSale: mocks.issueFiscalSale,
  isOrderFullyFiscalized: mocks.isOrderFullyFiscalized,
  getIssuedSaleDocumentsForOrder: mocks.getIssuedSaleDocumentsForOrder,
  paymentMethodLabel: vi.fn(() => "Uplata na račun"),
}));
vi.mock("@/lib/fiscal/pdf", () => ({
  buildFiscalReceiptPdf: mocks.buildFiscalReceiptPdf,
}));
vi.mock("@/lib/fiscal/pdf-storage", () => ({
  downloadFiscalPdf: vi.fn(),
}));
vi.mock("@/lib/fiscal/config", () => ({
  getFiscalConfig: vi.fn(() => ({ tin: "115085587", locationId: "1" })),
}));

import { issueAndDeliverFiscalReceipt } from "@/lib/fiscal/deliver";

const issuedAt = new Date("2026-09-17T12:05:00.000Z");
const order = {
  id: "26-000101",
  userId: undefined,
  createdAt: "2026-09-17T10:00:00.000Z",
  paymentMethod: "uplata_na_racun",
  shippingAddress: {
    firstName: "Petar",
    lastName: "Petrović",
    street: "Poslovna 1",
    postalCode: "11000",
    city: "Beograd",
    companyName: "Kupac doo",
    pib: "109876543",
  },
  billingAddress: undefined,
  items: [
    {
      sku: "SKU-1",
      name: "Stolica",
      qty: 1,
      unitPriceSale: 12_000,
      assemblyPrice: null,
    },
  ],
  subtotal: 12_000,
  shipping: 0,
  assemblyTotal: 0,
  voucherCode: null,
  voucherDiscount: null,
  total: 12_000,
};

describe("fiscal delivery company invoice", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.issueFiscalSale.mockResolvedValue({
      ok: true,
      created: true,
      receipt: {
        id: "fiscal-1",
        receiptNumber: "AB12/42",
        qrUrl: null,
        fiscalizedAt: issuedAt,
      },
      order: { id: "order-db-1", items: [] },
    });
    mocks.isOrderFullyFiscalized.mockResolvedValue(true);
    mocks.loadOrderForEmail.mockResolvedValue({
      recipient: "firma@example.rs",
      order,
    });
    mocks.getIssuedSaleDocumentsForOrder.mockResolvedValue([
      {
        id: "fiscal-1",
        receiptNumber: "AB12/42",
        issuedAt,
        qrUrl: null,
        pdfObjectKey: null,
        paymentMethod: "UPLATA_NA_RACUN",
        lines: [
          {
            sku: "SKU-1",
            shortName: "Stolica",
            qty: 1,
            unitPriceGross: 12_000,
            totalGross: 12_000,
          },
        ],
      },
    ]);
    mocks.buildFiscalReceiptPdf.mockReturnValue(Buffer.from("fiscal pdf"));
    mocks.buildWithdrawalFormPdf.mockResolvedValue(Buffer.from("withdrawal pdf"));
    mocks.issueFiscalBuyerInvoiceForOrder.mockResolvedValue({
      ok: true,
      issued: true,
      invoiceId: "invoice-1",
      number: "R-26-000101",
      bytes: Buffer.from("company invoice"),
    });
    mocks.markFiscalBuyerInvoiceEmailStatus.mockResolvedValue(undefined);
    mocks.sendFiscalReceipt.mockResolvedValue({
      ok: true,
      id: "email-1",
      provider: "ses",
    });
  });

  it("attaches the company invoice to the same fiscal email and marks it sent", async () => {
    await expect(issueAndDeliverFiscalReceipt("order-db-1")).resolves.toMatchObject({
      emailed: true,
    });

    expect(mocks.issueFiscalBuyerInvoiceForOrder).toHaveBeenCalledWith(
      "order-db-1",
      { issuedAt, fiscalReceiptNumbers: ["AB12/42"] },
    );
    expect(mocks.sendFiscalReceipt).toHaveBeenCalledWith(
      expect.objectContaining({
        buyerInvoiceAttached: true,
        attachments: expect.arrayContaining([
          expect.objectContaining({
            filename: "racun-26-000101.pdf",
            content: Buffer.from("company invoice").toString("base64"),
          }),
        ]),
      }),
    );
    expect(mocks.markFiscalBuyerInvoiceEmailStatus).toHaveBeenCalledWith(
      "invoice-1",
      expect.objectContaining({ emailedAt: expect.any(Date), error: null }),
    );
  });

  it("still sends the fiscal receipt if the supplementary invoice fails", async () => {
    mocks.issueFiscalBuyerInvoiceForOrder.mockRejectedValue(
      new Error("temporary storage failure"),
    );

    await expect(issueAndDeliverFiscalReceipt("order-db-1")).resolves.toMatchObject({
      emailed: true,
    });
    expect(mocks.sendFiscalReceipt).toHaveBeenCalledWith(
      expect.objectContaining({ buyerInvoiceAttached: false }),
    );
  });
});
