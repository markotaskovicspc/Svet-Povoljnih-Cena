import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync, writeFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireAdminAction, findUnique, findOrders, findWarehouses } = vi.hoisted(() => ({
  requireAdminAction: vi.fn(), findUnique: vi.fn(), findOrders: vi.fn(), findWarehouses: vi.fn(),
}));
vi.mock("@/lib/admin", () => ({ requireAdminAction, withAdminState: vi.fn() }));
vi.mock("@/lib/admin/inbound-invoice.server", () => ({
  cancelInboundInvoice: vi.fn(), createInboundInvoice: vi.fn(), lockInboundInvoice: vi.fn(),
  postInboundInvoice: vi.fn(), saveInboundInvoice: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: {
  inboundInvoice: { findUnique }, purchaseOrder: { findMany: findOrders }, warehouse: { findMany: findWarehouses },
} }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); }, redirect: vi.fn() }));
vi.mock("@/components/admin/auto-print-on-load", () => ({ AutoPrintOnLoad: () => <span data-auto-print /> }));
import InboundInvoicePage from "@/app/admin/erp/ulazne-fakture/[id]/page";
import styles from "@/components/admin/inbound-invoice-print.module.css";

function receipt() {
  return {
    id: "receipt", number: "PRI-2026-0100", status: "POSTED", lockedAt: new Date("2026-10-29T12:00:00Z"),
    invoiceDate: new Date("2026-10-29T23:00:00Z"), createdAt: new Date("2026-10-29T10:00:00Z"),
    supplier: { name: "Dobavljač za štampu" }, warehouse: { name: "Glavni magacin", code: "DC" },
    currency: "RSD", value: 1000, invoiceValueRsd: 1000, customsValueRsd: 100,
    transportValueRsd: 200, otherRelatedCostsRsd: 50, netValue: 1350, vatValue: 270, grossValue: 1620,
    notes: "Proveriti pakovanje.\nDrugi red napomene.",
    purchaseOrder: {
      id: "order", number: "PO-2026-0100", status: "RECEIVED", lockedAt: new Date("2026-10-29T12:00:00Z"),
      receivingWarehouse: null, transportDefinition: null, cogsBookingSnapshot: null,
      currency: "EUR", exchangeRate: 100, freightCost: 0, freightExchangeRate: 1,
      payments: [],
      items: [{ id: "line", sku: "210021", name: "Trpezarijska stolica ALFA", qty: 2, purchasePrice: 5,
        customsRate: 10, totalVolume: 1, totalWeight: 10, freightAllocated: 0, product: null }],
      inboundInvoices: [{ netValue: 1350, exchangeRate: 1, invoiceValueRsd: 1000 }],
    },
  };
}

async function print(query: { mode?: string; autoprint?: string } = { mode: "print" }) {
  return renderToStaticMarkup(await InboundInvoicePage({
    params: Promise.resolve({ id: "receipt" }), searchParams: Promise.resolve(query),
  }));
}

beforeEach(() => {
  vi.resetAllMocks();
  findUnique.mockResolvedValue(receipt());
  findOrders.mockResolvedValue([]);
  findWarehouses.mockResolvedValue([]);
});

describe("printing saved goods receipts", () => {
  it("requires the existing OPS permission before reading a receipt", async () => {
    requireAdminAction.mockRejectedValue(new Error("FORBIDDEN"));
    await expect(print()).rejects.toThrow("FORBIDDEN");
    expect(requireAdminAction).toHaveBeenCalledWith(["OPS"], "/admin/erp/ulazne-fakture");
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("returns not found for a missing receipt", async () => {
    findUnique.mockResolvedValue(null);
    await expect(print()).rejects.toThrow("NOT_FOUND");
  });

  it("prints the saved RSD allocation, quantities, totals, warehouse and Belgrade date", async () => {
    const html = await print({ mode: "print", autoprint: "1" });
    for (const text of ["PRIJEMNICA", "PRI-2026-0100", "Dobavljač za štampu", "Glavni magacin (DC)",
      "PO-2026-0100", "30. 10. 2026.", "Proknjižena", "210021", "Trpezarijska stolica ALFA",
      "1.000,00", "100,00", "200,00", "50,00", "675,00", "1.350,00 RSD", "270,00 RSD", "1.620,00 RSD",
      "Proveriti pakovanje.", "Primio", "Predao", "data-auto-print"]) expect(html).toContain(text);
    expect(html).not.toContain("NACRT");
    expect(html).not.toContain("Proknjiži");
    expect(html).not.toContain("<form");
    expect(html).not.toContain("Uredi");
    expect(html).not.toContain("1.350,00 EUR");
    expect(findOrders).not.toHaveBeenCalled();
    expect(findWarehouses).not.toHaveBeenCalled();
    if (process.env.INBOUND_PRINT_PREVIEW) {
      let css = readFileSync("src/components/admin/inbound-invoice-print.module.css", "utf8");
      css = css.replace(/\.([A-Za-z][\w-]*)/g, (_, name: string) => `.${styles[name]}`);
      writeFileSync(process.env.INBOUND_PRINT_PREVIEW, `<!doctype html><html lang="sr-Latn"><meta charset="utf-8"><title>Prijemnica — štampa</title><style>body{margin:0;background:#eee}*{box-sizing:border-box}p,h1,h2,dl,dd{margin:0}${css}</style><body>${html}</body></html>`);
    }
  });

  it("labels an unposted receipt and preserves source prices when RSD allocation is impossible", async () => {
    const invoice = receipt();
    findUnique.mockResolvedValue({ ...invoice, lockedAt: null, status: "DRAFT", value: 999,
      purchaseOrder: { ...invoice.purchaseOrder, lockedAt: null, status: "POSTED" } });
    const html = await print();
    expect(html).toContain("NACRT — prijemnica nije proknjižena");
    expect(html).toContain("moraju biti iste");
    expect(html).toContain("COGS u RSD nije obračunat");
    expect(html).toContain("Stavke porudžbenice — EUR");
    expect(html).toContain("5,00");
    expect(html).not.toContain("675,00");
    expect(html).not.toContain("data-auto-print");
  });

  it("marks cancelled receipts and keeps legacy invoice currency explicit", async () => {
    findUnique.mockResolvedValue({ ...receipt(), status: "CANCELLED", invoiceValueRsd: null, currency: "EUR" });
    const html = await print();
    expect(html).toContain("STORNO — prijemnica je stornirana");
    expect(html).toContain("1.350,00 EUR");
    expect(html).not.toContain("NACRT");
  });
});
