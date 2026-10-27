import { Children, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invoice: vi.fn(), orders: vi.fn(), warehouses: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: {
  inboundInvoice: { findUnique: mocks.invoice },
  purchaseOrder: { findMany: mocks.orders }, warehouse: { findMany: mocks.warehouses },
} }));
vi.mock("@/lib/admin", () => ({ requireAdminAction: vi.fn(async () => ({ id: "admin", role: "SUPER" })), withAdminState: vi.fn() }));
vi.mock("@/lib/admin/inbound-invoice.server", () => ({
  cancelInboundInvoice: vi.fn(), createInboundInvoice: vi.fn(), lockInboundInvoice: vi.fn(),
  postInboundInvoice: vi.fn(), saveInboundInvoice: vi.fn(),
}));
vi.mock("@/lib/admin/purchase-payments.server", () => ({ summarizePurchasePayments: vi.fn(() => ({ count: 0, totalAmount: "0.00", totalRsd: "0.00", version: "empty" })) }));
vi.mock("@/components/admin/purchasing-reopen-form", () => ({ PurchasingReopenForm: () => null }));
vi.mock("@/lib/admin/goods-receipt-readiness", () => ({ goodsReceiptMasterWarnings: () => [] }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));

import InboundInvoicePage from "@/app/admin/erp/ulazne-fakture/[id]/page";
import { InboundInvoiceCogsTable, type InboundCogsRow } from "@/components/admin/inbound-invoice-cogs-table";

function fixture({ stock = -477, cogs = null as number | null, qty = 189, price = 53.1, previousQty = 0, previousCostRsd = 0, reopened = true } = {}) {
  const value = Math.round(qty * price * 100) / 100;
  return {
    id: "receipt", number: "UF-2026-0030", status: "RECEIVED", lockedAt: null,
    createdAt: new Date("2026-10-19"), invoiceDate: new Date("2026-10-19"),
    purchaseOrderId: "po", warehouseId: "dc", supplierId: "supplier", notes: null,
    currency: "RSD", exchangeRate: 1, value, invoiceValueRsd: value, netValue: value,
    customsValueRsd: 0, transportValueRsd: 0, otherRelatedCostsRsd: 0,
    purchaseOrder: {
      id: "po", number: "26/26", status: reopened ? "RECEIVED" : "DRAFT", lockedAt: null,
      createdAt: new Date("2026-10-19"), cogsBookedAt: null,
      currency: "RSD", exchangeRate: 1, freightCost: 0, freightExchangeRate: 1,
      supplier: null, receivingWarehouse: null, transportDefinition: null,
      cogsBookingSnapshot: reopened ? { reopening: {
        version: 1, token: "fd791d1c-219f-490f-a535-d7db01fa6b39",
        invoiceId: "receipt", warehouseId: "dc", supplierId: "supplier",
        products: [{ productId: "product", sku: "110125", qty: previousQty, costRsd: previousCostRsd }],
      } } : null,
      inboundInvoices: [{ id: "receipt", netValue: value, invoiceValueRsd: value, exchangeRate: 1 }],
      items: [{ id: "line", sku: "110125", name: "Čarape", qty, purchasePrice: price,
        customsRate: 0, totalVolume: 0.1, totalWeight: 1, freightAllocated: 0,
        product: { id: "product", sku: "110125", name: "Čarape", stock, cogs, customsRate: 0 },
      }],
    },
  };
}

function cogsRows(node: ReactNode): InboundCogsRow[] | undefined {
  for (const child of Children.toArray(node)) {
    if (!isValidElement<{ children?: ReactNode; rows?: InboundCogsRow[] }>(child)) continue;
    if (child.type === InboundInvoiceCogsTable) return child.props.rows;
    const nested = cogsRows(child.props.children);
    if (nested) return nested;
  }
}
async function preview() {
  return cogsRows(await InboundInvoicePage({ params: Promise.resolve({ id: "receipt" }), searchParams: Promise.resolve({}) }))!;
}
beforeEach(() => {
  mocks.invoice.mockResolvedValue(fixture());
  mocks.orders.mockResolvedValue([]);
  mocks.warehouses.mockResolvedValue([]);
});

describe("receipt COGS preview after changing a received purchase order", () => {
  it("keeps the receipt open and reports the exact stock validation instead of crashing", async () => {
    const rows = await preview();
    expect(rows[0]).toMatchObject({ sku: "110125", existingQty: -477, finalCogs: null,
      finalCogsError: "Nema dovoljno raspoloživih zaliha za ispravku 110125." });
    const html = renderToStaticMarkup(<InboundInvoiceCogsTable rows={rows} purchaseCurrency="RSD" />);
    expect(html).toContain("Nema dovoljno raspoloživih zaliha za ispravku 110125.");
    expect(html).toContain("Finalni COGS nije obračunat");
    expect(html).not.toContain("NaN");
  });
  it("uses the correction delta directly even when the current stock is negative", async () => {
    mocks.invoice.mockResolvedValue(fixture({ stock: -2, qty: 5, price: 100 }));
    const rows = await preview();
    expect(rows[0].finalCogs).toBe(166.67);
    expect(rows[0].finalCogsError).toBeUndefined();
  });
  it("corrects only the difference after earlier sales", async () => {
    mocks.invoice.mockResolvedValue(fixture({ stock: 40, cogs: 100, qty: 12, price: 120, previousQty: 10, previousCostRsd: 1000 }));
    expect((await preview())[0].finalCogs).toBe(105.71);
  });
  it("preserves the weighted average for a regular new receipt", async () => {
    mocks.invoice.mockResolvedValue(fixture({ stock: 40, cogs: 100, qty: 12, price: 120, reopened: false }));
    expect((await preview())[0].finalCogs).toBe(104.62);
  });
  it("also keeps a regular receipt editable when existing stock is invalid", async () => {
    mocks.invoice.mockResolvedValue(fixture({ reopened: false }));
    expect((await preview())[0]).toMatchObject({ finalCogs: null, finalCogsError: "Postojeće stanje zaliha je negativno (-477). Proverite lager pre knjiženja." });
  });
});
