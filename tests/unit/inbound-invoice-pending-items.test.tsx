import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { InboundInvoicePendingItems } from "@/components/admin/inbound-invoice-pending-items";
import { reconcileInboundGoods } from "@/lib/admin/inbound-invoice";
import { purchaseOrderGoodsTotal } from "@/lib/admin/purchase-order";

// Prices and quantities from the reported screenshot; IDs are test-only.
const items = [[5.66, 120], [7.64, 90], [9, 100], [11.5, 200], [16.5, 200], [31, 200], [49, 25], [68, 25]]
  .map(([purchasePrice, qty], index) => ({
    id: `line-${index}`, sku: `TEST-${index}`, name: `Artikal ${index}`,
    purchasePrice, qty,
  }));

describe("receipt lines while COGS is blocked", () => {
  it("keeps all eight source lines visible without inventing a dinar COGS", () => {
    const reconciliation = reconcileInboundGoods({
      invoiceCurrency: "EUR", orderCurrency: "USD", invoiceValue: 1_717_177,
      invoiceValueRsd: 1_717_177, lines: items,
    });
    expect(reconciliation.error).toContain("Valuta fakture");
    expect(reconciliation.lineValuesRsd).toBeNull();
    const html = renderToStaticMarkup(createElement(InboundInvoicePendingItems, {
      items, currency: "USD", purchaseOrderId: "test-order",
    }));
    for (const item of items) expect(html).toContain(item.sku);
    expect(html).toContain("16.991,80");
    expect(html).toContain("960");
    expect(html).toContain("1.700,00");
    expect(html).toContain("COGS u RSD nije obračunat");
    expect(html).not.toContain("73.275,19");
    expect(html).toContain('href="/admin/erp/porudzbenice/test-order"');
  });

  it("distinguishes the saved 25 USD price from the photographed 68 USD price", () => {
    const oldItems = items.map((item, index) => index === 7 ? { ...item, purchasePrice: 25 } : item);
    expect(purchaseOrderGoodsTotal(oldItems)).toBe(15_916.8);
    expect(purchaseOrderGoodsTotal(items)).toBe(16_991.8);
    expect(purchaseOrderGoodsTotal(items) - purchaseOrderGoodsTotal(oldItems)).toBe(1_075);
    expect(purchaseOrderGoodsTotal([])).toBe(0);
  });
});

it("links known article IDs without inventing links for unmatched lines", () => {
  const html = renderToStaticMarkup(createElement(InboundInvoicePendingItems, { items: [{ ...items[0], productId: "product-1" }, items[1]], currency: "USD", purchaseOrderId: "po" }));
  expect(html).toContain('href="/admin/erp/artikli/product-1"'); expect(html).not.toContain('/admin/erp/artikli/undefined');
});
