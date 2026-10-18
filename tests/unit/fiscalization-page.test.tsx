import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { formatRsd } from "@/lib/format";

const mocks = vi.hoisted(() => ({
  lines: vi.fn(), warehouses: vi.fn(), orders: vi.fn(), ananas: vi.fn(), rows: vi.fn(), products: vi.fn(), prices: vi.fn(), invoices: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: {
  product: { findMany: mocks.products },
  purchasePrice: { findMany: mocks.prices },
  inboundInvoice: { findMany: mocks.invoices },
  fiscalDocumentLine: { findMany: mocks.lines },
  warehouse: { findMany: mocks.warehouses },
  order: { findMany: mocks.orders },
  ananasDocument: { findMany: mocks.ananas },
} }));
vi.mock("@/lib/admin", () => ({ requireAdminAction: vi.fn(), withAdminState: vi.fn() }));
vi.mock("@/lib/fiscal", () => ({
  ensureDefaultWarehouse: vi.fn(), issueFiscalRefund: vi.fn(),
  issueAndDeliverFiscalReceipt: vi.fn(), paymentMethodLabel: (value: string) => value,
}));
vi.mock("@/app/admin/fiskalizacija/fiscalization-client", () => ({
  FiscalizationClient: ({ rows }: { rows: unknown[] }) => {
    mocks.rows(rows);
    return null;
  },
}));

import FiscalizationPage from "@/app/admin/fiskalizacija/page";

const issuedAt = new Date("2026-10-15T16:35:00Z");
const merchandise = {
  id: "item", orderNumber: "SPC-TEST", createdAt: issuedAt,
  customerName: "Kupac", companyName: null, sku: "STO", shortName: "Sto sa montažom",
  qty: 1, refundedQty: 0, unitPriceGross: 2400, totalGross: 2400,
  totalNet: 2000, serviceGross: 400, vatRate: 20, unitCogs: 1000,
  fiscalDocument: { receiptNumber: "SALE-1", issuedAt, paymentMethod: "UPLATA_NA_RACUN", kind: "SALE" },
};
const shipping = {
  ...merchandise, id: "shipping", sku: "DOSTAVA", shortName: "Dostava",
  unitPriceGross: 599, totalGross: 599, totalNet: 499.17, serviceGross: 599, unitCogs: null,
};
const ananas = {
  id: "ananas", kind: "SALE", orderNumber: "ANA-TEST", fiscalNumber: "ANA-1", issuedAt,
  paymentMethods: "cash", items: [
    { sku: "STO", name: "Sto", quantity: 1, gross: 2000, net: 1666.67 },
    { sku: "DOSTAVA", name: "Dostava", quantity: 1, gross: 399, net: 332.5 },
  ],
};

beforeEach(() => {
  mocks.products.mockResolvedValue([{ sku: "STO", cogs: 900 }]);
  mocks.prices.mockResolvedValue([]);
  mocks.invoices.mockResolvedValue([]);
  mocks.lines.mockResolvedValue([merchandise, shipping]);
  mocks.warehouses.mockResolvedValue([]);
  mocks.orders.mockResolvedValue([]);
  mocks.ananas.mockResolvedValue([ananas]);
});
const render = async (searchParams: { items?: string; channel?: string } = {}) => {
  const html = renderToStaticMarkup(await FiscalizationPage({ searchParams: Promise.resolve(searchParams) }));
  return { html, rows: mocks.rows.mock.lastCall![0] };
};

describe("fiscalization receipt amounts", () => {
  it("shows issued shipping and the full merchandise price including assembly by default", async () => {
    const { html, rows } = await render();
    expect(rows).toHaveLength(4);
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "item", totalGross: formatRsd(2400), totalNet: formatRsd(2000) }),
      expect.objectContaining({ id: "shipping", sku: "DOSTAVA", totalGross: formatRsd(599), totalNet: formatRsd(499.17), cogs: "—" }),
      expect.objectContaining({ channel: "Ananas", sku: "DOSTAVA", totalGross: formatRsd(399) }),
    ]));
    expect(html).toContain("Sve, sa dostavom i montažom");
  });

  it("preserves the merchandise view only when explicitly selected", async () => {
    const { rows } = await render({ items: "merchandise" });
    expect(rows).toHaveLength(2);
    expect(rows.every((row: { sku: string }) => row.sku !== "DOSTAVA")).toBe(true);
    expect(rows).toContainEqual(expect.objectContaining({ id: "item", totalGross: formatRsd(2000), totalNet: formatRsd(1666.67) }));
  });

  it("keeps service refund amounts negative and prevents another refund", async () => {
    mocks.lines.mockResolvedValue([{ ...shipping, id: "refund-shipping", fiscalDocument: { ...shipping.fiscalDocument, kind: "REFUND" } }]);
    const { rows } = await render({ channel: "SPC" });
    expect(rows).toEqual([expect.objectContaining({ id: "refund-shipping", qty: -1, totalGross: formatRsd(-599), totalNet: formatRsd(-499.17), canRefund: false, refunded: true })]);
  });
});

it("fills Ananas sale and refund costs, excluding services and using the original sale outside the filter", async () => {
  mocks.ananas.mockResolvedValueOnce([{ ...ananas, kind: "REFUND", reference: "ANA-ORIGINAL", issuedAt: new Date("2026-10-18T12:00:00Z") }])
    .mockResolvedValueOnce([{ fiscalNumber: "ANA-ORIGINAL", issuedAt }]);
  mocks.prices.mockResolvedValue([
    { sku: "STO", price: 700, validFrom: new Date("2026-10-01"), validTo: new Date("2026-10-15") },
    { sku: "STO", price: 800, validFrom: new Date("2026-10-16"), validTo: null },
  ]);
  const { rows } = await render({ channel: "ANANAS" });
  expect(rows).toContainEqual(expect.objectContaining({ channel: "Ananas", sku: "STO", cogs: formatRsd(700), totalCogs: formatRsd(-700) }));
  expect(rows).toContainEqual(expect.objectContaining({ channel: "Ananas", sku: "DOSTAVA", cogs: "—", totalCogs: "—" }));
  expect(mocks.ananas.mock.calls.at(-1)![0].where).toEqual({ kind: "SALE", fiscalNumber: { in: ["ANA-ORIGINAL"] } });
});
it("replaces the first available fallback after a backdated invoice is posted", async () => {
  const invoice = (day: string, price: number) => ({ invoiceDate: new Date(day), lockedAt: new Date(), purchaseOrder: {
    exchangeRate: 1, cogsBookingSnapshot: { version: 1, products: [{ productId: "p", sku: "STO", stock: 0, cogs: null }] },
    items: [{ sku: "STO", productId: "p", qty: 10, purchasePrice: price, customsRate: 0, freightAllocated: 0, additionalCostAllocated: 0 }],
  } });
  mocks.lines.mockResolvedValue([{ ...merchandise, unitCogs: null }]);
  mocks.invoices.mockResolvedValue([invoice("2026-10-17", 900)]);
  let result = await render();
  expect(result.rows.filter((row: { sku: string }) => row.sku === "STO")).toEqual(expect.arrayContaining([
    expect.objectContaining({ channel: "SPC", cogs: formatRsd(900) }),
    expect.objectContaining({ channel: "Ananas", cogs: formatRsd(900) }),
  ]));
  mocks.invoices.mockResolvedValue([invoice("2026-10-01", 600), invoice("2026-10-17", 900)]);
  result = await render();
  for (const row of result.rows.filter((row: { sku: string }) => row.sku === "STO")) expect(row.cogs).toBe(formatRsd(600));
});
