import { Prisma } from "@prisma/client";
import { beforeEach, expect, it, vi } from "vitest";

vi.mock("@/lib/db", async (importOriginal) => ({ ...await importOriginal<typeof import("@/lib/db")>(), db: {} }));
const baselines = vi.hoisted(() => vi.fn());
vi.mock("@/lib/admin/inbound-inventory-history.server", () => ({ loadReceiptStockBaselines: baselines }));
vi.mock("@/lib/admin/incoming-stock.server", () => ({ recomputeIncomingStockForPurchaseOrders: vi.fn() }));
import { rebuildInboundInvoiceAllocations } from "@/lib/admin/inbound-invoice.server";

function fixture() {
  const order = {
    id: "po", number: "37/26", status: "DRAFT", receivingWarehouseId: "ananas", exchangeRate: 1, freightCost: 0, freightExchangeRate: 1,
    cogsBookedAt: null as Date | null, cogsBookingSnapshot: null as unknown,
    items: [{ id: "line", sku: "110120", qty: 240, purchasePrice: 52.7, customsRate: 0,
      freightAllocated: 0, additionalCostAllocated: 0, totalVolume: 1, totalWeight: 1,
      product: { id: "p", stock: -98, cogs: 99 },
    }],
    inboundInvoices: [{ status: "POSTED", lockedAt: new Date(), warehouseId: "ananas", invoiceDate: new Date("2025-10-20T22:00:00Z"),
      netValue: 12648, exchangeRate: 1, invoiceValueRsd: 12648, customsValueRsd: 0, transportValueRsd: 0, otherRelatedCostsRsd: 0,
    }],
  };
  const tx = {
    $queryRaw: vi.fn(async () => [{ id: "p" }]),
    purchaseOrder: { findUnique: vi.fn(async () => order), update: vi.fn(async ({ data }) => Object.assign(order, data)) },
    purchaseOrderItem: { update: vi.fn() },
    product: { update: vi.fn(), updateMany: vi.fn() },
  };
  return { order, tx, client: tx as unknown as Prisma.TransactionClient };
}
beforeEach(() => {
  vi.clearAllMocks();
  baselines.mockResolvedValue(new Map([["p", { productId: "p", sku: "110120", stock: 0, cogs: null, currentCogs: 99, error: null }]]));
});
it("books against the receipt-day stock, saves that baseline, and reuses it on retries", async () => {
  const { tx, order, client } = fixture();
  await rebuildInboundInvoiceAllocations(client, "po");
  expect(baselines).toHaveBeenCalledWith(["p"], new Date("2025-10-20T22:00:00Z"), "po", client);
  expect(order.cogsBookingSnapshot).toEqual({ version: 1, receiptDay: "2025-10-21", products: [
    { productId: "p", sku: "110120", stock: 0, cogs: null, previousCogs: 99 },
  ] });
  expect(tx.product.update).toHaveBeenCalledWith({ where: { id: "p" }, data: { cogs: 52.7 } });
  await rebuildInboundInvoiceAllocations(client, "po");
  expect(baselines).toHaveBeenCalledTimes(1);
  expect(tx.product.update).toHaveBeenCalledTimes(2);
  expect(tx.product.update.mock.calls[1][0].data.cogs).toBe(52.7);
});
it("weights earlier stock at its historical cost rather than today's negative quantity", async () => {
  baselines.mockResolvedValue(new Map([["p", { productId: "p", sku: "110120", stock: 60, cogs: 100, error: null }]]));
  const { client, tx } = fixture();
  await rebuildInboundInvoiceAllocations(client, "po");
  expect(tx.product.update).toHaveBeenCalledWith({ where: { id: "p" }, data: { cogs: 62.16 } });
});
it("stops unsafe historical accounting before changing product COGS or saving a snapshot", async () => {
  baselines.mockResolvedValue(new Map([["p", { productId: "p", sku: "110120", stock: -1, cogs: null, error: "Raniji lager je negativan" }]]));
  const { client, tx } = fixture();
  await expect(rebuildInboundInvoiceAllocations(client, "po")).rejects.toThrow("Raniji lager je negativan");
  expect(tx.product.update).not.toHaveBeenCalled();
  expect(tx.purchaseOrder.update).not.toHaveBeenCalled();
});
it("restores the cost before booking when an unfinished booking is reversed", async () => {
  const { client, tx, order } = fixture();
  await rebuildInboundInvoiceAllocations(client, "po");
  order.inboundInvoices = [];
  await rebuildInboundInvoiceAllocations(client, "po");
  expect(tx.product.updateMany).toHaveBeenCalledWith({ where: { id: "p" }, data: { cogs: 99 } });
});
