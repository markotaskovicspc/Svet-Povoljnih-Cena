import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { InboundInvoiceFields } from "@/components/admin/inbound-invoice-fields";

describe("receipt FX fields", () => {
  const paidOrder = {
    id: "po", number: "PO", supplierId: "supplier", supplierName: "Dobavljač",
    currency: "EUR" as const, exchangeRate: 117, invoiceValue: 1000, invoiceValueRsd: 117000,
    customsValueRsd: 100, transportValueRsd: 200,
    payments: { count: 2, version: "ledger-version", totalAmount: "1000.00", totalRsd: "117700.00" },
  };
  const initial = {
    purchaseOrderId: "po", supplierId: "supplier", supplierName: "Dobavljač",
    currency: "RSD" as const, exchangeRate: 1, invoiceValue: 0, invoiceValueRsd: null,
    customsValueRsd: null, transportValueRsd: null, otherRelatedCostsRsd: null, legacyNetValue: 0,
  };
  it("prefills a new linked receipt with actual payments instead of the estimated FX total", () => {
    const html = renderToStaticMarkup(createElement(InboundInvoiceFields, {
      editing: true, purchaseOrders: [paidOrder], initial,
    }));
    expect(html.match(/<input[^>]*name="invoiceValue"[^>]*>/)?.[0]).toContain('value="117700"');
    expect(html.match(/<input[^>]*name="paymentVersion"[^>]*>/)?.[0]).toContain('value="ledger-version"');
    expect(html.match(/<input[^>]*name="customsValueRsd"[^>]*>/)?.[0]).toContain('value="100"');
    expect(html.match(/<input[^>]*name="transportValueRsd"[^>]*>/)?.[0]).toContain('value="200"');
  });
  it("keeps saved goods and other costs on reopening even when the payment sum is different", () => {
    const html = renderToStaticMarkup(createElement(InboundInvoiceFields, {
      editing: true, purchaseOrders: [paidOrder],
      initial: { ...initial, invoiceValue: 999, invoiceValueRsd: 999,
        customsValueRsd: 11, transportValueRsd: 22, otherRelatedCostsRsd: 33 },
    }));
    expect(html.match(/<input[^>]*name="invoiceValue"[^>]*>/)?.[0]).toContain('value="999"');
    expect(html.match(/<input[^>]*name="paymentVersion"[^>]*>/)?.[0]).toContain('value=""');
    expect(html.match(/<input[^>]*name="customsValueRsd"[^>]*>/)?.[0]).toContain('value="11"');
    expect(html.match(/<input[^>]*name="transportValueRsd"[^>]*>/)?.[0]).toContain('value="22"');
    expect(html.match(/<input[^>]*name="otherRelatedCostsRsd"[^>]*>/)?.[0]).toContain('value="33"');
  });
  it("reopens the exact saved dinar amount instead of recalculating it from rounded FX", () => {
    const html = renderToStaticMarkup(createElement(InboundInvoiceFields, {
      editing: true, purchaseOrders: [], initial: {
        purchaseOrderId: null, supplierId: null, supplierName: null,
        currency: "USD", exchangeRate: 101.057968, invoiceValue: 16_992,
        invoiceValueRsd: 1_717_177, customsValueRsd: 42_439,
        transportValueRsd: 393_345, otherRelatedCostsRsd: 29_555,
        legacyNetValue: 2_182_516,
      },
    }));
    const input = (name: string) => html.match(new RegExp(`<input[^>]*name="${name}"[^>]*>`))?.[0];
    expect(input("invoiceValueRsd")).toContain('value="1717177"');
    expect(input("invoiceValue")).toContain('value="1717177"');
    expect(input("invoiceValue")).not.toMatch(/\sreadonly=/i);
    expect(input("exchangeRate")).toContain('value="1"');

    expect(input("netValue")).toContain('value="2182516"');
    expect(input("currency")).toContain('value="RSD"');
    expect(html).not.toContain('Način unosa kursa');
  });
});
