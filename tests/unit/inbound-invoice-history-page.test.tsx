import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invoice: vi.fn(), baselines: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: {
  inboundInvoice: { findUnique: mocks.invoice }, purchaseOrder: { findMany: async () => [] }, warehouse: { findMany: async () => [] },
} }));
vi.mock("@/lib/admin", () => ({ requireAdminAction: vi.fn(), withAdminState: vi.fn() }));
vi.mock("@/lib/admin/inbound-invoice.server", () => ({
  cancelInboundInvoice: vi.fn(), createInboundInvoice: vi.fn(), lockInboundInvoice: vi.fn(), postInboundInvoice: vi.fn(), saveInboundInvoice: vi.fn(),
}));
vi.mock("@/lib/admin/inbound-inventory-history.server", () => ({ loadReceiptStockBaselines: mocks.baselines }));
vi.mock("@/components/admin/action-form", () => ({ AdminActionForm: ({ children }: { children: ReactNode }) => <form>{children}</form> }));
vi.mock("@/components/admin/submit-button", () => ({ SubmitButton: ({ children }: { children: ReactNode }) => <button>{children}</button> }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); }, redirect: vi.fn() }));
import Page from "@/app/admin/erp/ulazne-fakture/[id]/page";

function invoice() {
  return { id: "receipt", number: "UF-2026-0035", invoiceDate: new Date("2025-10-20T22:00:00Z"),
    createdAt: new Date(), lockedAt: null as Date | null, status: "RECEIVED", purchaseOrderId: "po", warehouseId: "ananas",
    supplier: { id: "s", name: "Modital" }, supplierId: "s", warehouse: { id: "ananas", name: "Ananas", code: "MAG-001" },
    type: "COGS", currency: "RSD", exchangeRate: 1, value: 12648, invoiceValueRsd: 12648,
    customsValueRsd: 0, transportValueRsd: 0, otherRelatedCostsRsd: 0, netValue: 12648, vatValue: 2529.6, grossValue: 15177.6, notes: null,
    purchaseOrder: { id: "po", number: "37/26", status: "DRAFT", lockedAt: new Date(),
      cogsBookingSnapshot: null as unknown, cogsBookedAt: null as Date | null,
      currency: "RSD", exchangeRate: 1, freightCost: 0, freightExchangeRate: 1, totalVolume: 1, totalWeight: 1,
      supplier: { id: "s", name: "Modital" }, receivingWarehouse: null, transportDefinition: null, inboundInvoices: [], payments: [],
      items: [{ id: "line", sku: "110120", name: "Čarape", qty: 240, purchasePrice: 52.7, customsRate: 0,
        totalVolume: 1, totalWeight: 1, freightAllocated: 0,
        product: { id: "p", sku: "110120", name: "Čarape", description: "Čarape", supplierId: "s", stock: -98, cogs: 99, customsRate: 0,
          supplier: { country: "RS" }, countryOfOrigin: "RS", hsCode: "1234", categories: [], priceListEntries: [],
          containerQty: 1000, containerGrossWeightKg: null, packQty: 1, packWidthCm: 10, packDepthCm: 10, packHeightCm: 10,
        },
      }],
    },
  };
}
const render = async () => renderToStaticMarkup(await Page({ params: Promise.resolve({ id: "receipt" }), searchParams: Promise.resolve({ mode: "edit" }) }));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.invoice.mockResolvedValue(invoice());
  mocks.baselines.mockResolvedValue(new Map([["p", { productId: "p", sku: "110120", stock: 50, cogs: 52.7, currentCogs: 99, error: null }]]));
});
it("shows the saved Belgrade date and historical stock despite today's negative quantity", async () => {
  const html = await render();
  expect(html).toContain('value="2025-10-21"');
  expect(html).toContain("50 × 52,70 RSD");
  expect(html).not.toContain("-98 ×");
  expect(mocks.baselines).toHaveBeenCalledWith(["p"], new Date("2025-10-20T22:00:00Z"), "po");
});
it("shows an actionable historical error while keeping the receipt screen usable", async () => {
  mocks.baselines.mockResolvedValue(new Map([["p", { stock: -1, cogs: null, error: "110120: Stanje pre prijema je negativno (-1)." }]]));
  const html = await render();
  expect(html).toContain("Stanje pre prijema je negativno (-1)");
  expect(html).toContain("—</td>");
  expect(html).toContain("Podaci prijemnice");
});
it("retains the original booked baseline instead of displaying a later product cost", async () => {
  const saved = invoice();
  saved.lockedAt = new Date(); saved.status = "POSTED";
  saved.purchaseOrder.status = "RECEIVED";
  saved.purchaseOrder.cogsBookedAt = new Date();
  saved.purchaseOrder.cogsBookingSnapshot = { version: 1, products: [{ productId: "p", sku: "110120", stock: 0, cogs: null }] };
  mocks.invoice.mockResolvedValue(saved);
  const html = await render();
  expect(html).toContain("0 × 52,70 RSD");
  expect(html).not.toContain("99,00 RSD");
  expect(mocks.baselines).not.toHaveBeenCalled();
});
