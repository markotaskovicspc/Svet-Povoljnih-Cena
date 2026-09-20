import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { InboundInvoiceFields } from "@/components/admin/inbound-invoice-fields";

describe("receipt FX fields", () => {
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
    expect(input("invoiceValueRsd")).not.toMatch(/\sreadonly=/i);
    expect(input("exchangeRate")).toContain('value="101.057968"');
    expect(input("exchangeRate")).toMatch(/\sreadonly=/i);
    expect(input("netValue")).toContain('value="2182516"');
    expect(html).toContain('value="RSD_VALUE" selected=""');
  });
});
