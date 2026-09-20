import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  read: vi.fn(), transaction: vi.fn(), write: vi.fn(),
  recompute: vi.fn(), post: vi.fn(), receive: vi.fn(),
  orderRead: vi.fn(), warehouseRead: vi.fn(), linkedRead: vi.fn(), savedRead: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: {
  inboundInvoice: { findUnique: mocks.read, update: mocks.write, updateMany: mocks.write, findFirst: mocks.linkedRead, findUniqueOrThrow: mocks.savedRead },
  purchaseOrder: { update: mocks.write, findUnique: mocks.orderRead },
  warehouse: { findUnique: mocks.warehouseRead },
  $transaction: mocks.transaction,
} }));
vi.mock("@/lib/admin/incoming-stock.server", () => ({ recomputeIncomingStockForPurchaseOrders: vi.fn() }));
vi.mock("@/lib/admin/po", () => ({
  recomputePurchaseOrderTotals: mocks.recompute,
  postPurchaseOrder: mocks.post,
  receivePurchaseOrder: mocks.receive,
}));
import { lockInboundInvoice, postInboundInvoice, saveInboundInvoice } from "@/lib/admin/inbound-invoice.server";

const decimal = (value: number) => new Prisma.Decimal(value);
function receipt() {
  return {
    id: "receipt", lockedAt: null, status: "RECEIVED", invoiceDate: new Date(),
    supplier: { id: "supplier" }, purchaseOrderId: "po", currency: "USD",
    value: decimal(16_992), invoiceValueRsd: decimal(1_717_177),
    purchaseOrder: {
      id: "po", lockedAt: new Date(), currency: "USD",
      supplier: { integrationKey: null },
      items: [
        { sku: "110170", qty: 120, purchasePrice: decimal(5.66), totalVolume: decimal(1) },
        { sku: "remaining", qty: 1, purchasePrice: decimal(15_237.6), totalVolume: decimal(1) },
      ],
    },
  };
}

describe("receipt goods reconciliation before accounting mutations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.read.mockResolvedValue(receipt());
    mocks.transaction.mockImplementation(async (fn) => fn({
      inboundInvoice: { findUnique: mocks.read, updateMany: mocks.write },
    }));
  });

  it("blocks the mismatched receipt before changing the PO, warehouse or stock", async () => {
    await expect(postInboundInvoice("receipt", "admin")).rejects.toThrow("1.075,20 USD");
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.recompute).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
    expect(mocks.post).not.toHaveBeenCalled();
    expect(mocks.receive).not.toHaveBeenCalled();
  });

  it("also checks reconciliation inside the lock transaction", async () => {
    await expect(lockInboundInvoice("receipt")).rejects.toThrow("1.075,20 USD");
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("allows a reconciled invoice to continue to normal posting checks", async () => {
    const invoice = receipt();
    invoice.value = decimal(15_916.8);
    mocks.read.mockResolvedValue(invoice);
    mocks.recompute.mockRejectedValueOnce(new Error("Reached normal posting checks"));
    await expect(postInboundInvoice("receipt", "admin")).rejects.toThrow("Reached normal posting checks");
    expect(mocks.recompute).toHaveBeenCalledWith("po");
  });

  it("saves the authoritative RSD amount and calculates FX on the server", async () => {
    mocks.orderRead.mockResolvedValue({ status: "DRAFT", supplierId: "supplier", supplier: { enabled: true } });
    mocks.warehouseRead.mockResolvedValue({ id: "dc", active: true });
    mocks.linkedRead.mockResolvedValue(null);
    mocks.write.mockResolvedValue({ count: 1 });
    mocks.savedRead.mockResolvedValue({ id: "receipt" });
    await saveInboundInvoice({
      id: "receipt", number: "UF-2026-0025", receiptDate: new Date(), purchaseOrderId: "po", warehouseId: "dc",
      currency: "USD", invoiceValue: 16_992, invoiceValueRsd: 1_717_177, exchangeRate: 999, exchangeRateSource: "RSD_VALUE",
      customsValueRsd: 42_439, transportValueRsd: 393_345, otherRelatedCostsRsd: 29_555, notes: null,
    });
    expect(mocks.write).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      currency: "USD", value: 16_992, exchangeRate: 101.057968, invoiceValueRsd: 1_717_177, netValue: 2_182_516,
    }) }));
  });
});
