import { describe, expect, it } from "vitest";
import { buildXExpressArticleLabels } from "@/lib/x-express/article-labels";
import { derivePhysicalPackages } from "@/lib/courier/packages";
import { renderXExpressLabelsHtml, type XExpressLabelShipment } from "@/lib/x-express/labels";

const items = [
  { id: "a", sku: "001", name: "POMPEA ženske čarape crne 38–40", qty: 2 },
  { id: "b", sku: "002", name: "POMPEA muški veš beli XL", qty: 3 },
];
const packages = derivePhysicalPackages(items);
const code = "AAA0850300001";
const shipment: XExpressLabelShipment = {
  id: "packing-test", trackingNo: code, packageCount: 1, providerParcelNumbers: [code],
  providerRouteCode: "BG-ZE-4", providerRouteName: null, rawCreateResponse: null,
  createdAt: new Date(), purpose: "ORDER_DELIVERY",
  order: { number: "QA-POMPEA", total: 1200, paymentMethod: "POUZECE_GOTOVINA",
    shipFirstName: "Test", shipLastName: "Kupac", shipPhone: "0601234567",
    shipStreet: "Test ulica 10", shipCity: "Beograd", shipPostalCode: "11000", notes: null, items },
};

describe("Pompea packing list on one buyer label", () => {
  it("prints every name, SKU and exact packed quantity from the new courier snapshot", () => {
    const articleLabels = buildXExpressArticleLabels({ codes: [code], packages, items, purpose: "ORDER_DELIVERY" });
    const html = renderXExpressLabelsHtml({ ...shipment, rawCreateResponse: { articleLabels } });
    expect(html.match(/<section class="label">/g)).toHaveLength(1);
    expect(html).toContain("U kutiji: 5 kom");
    for (const item of items) {
      expect(html).toContain(item.name);
      expect(html).toContain(`Šifra: ${item.sku}`);
      expect(html).toContain(`<strong>${item.qty} ×</strong>`);
    }
    expect(html).not.toContain("Barkod artikla");
  });

  it("repairs an existing summary-only snapshot using the matching picking parcel", () => {
    const html = renderXExpressLabelsHtml({ ...shipment,
      rawCreateResponse: { articleLabels: [{ Code: code, name: "POMPEA · 2 stavki · 5 kom", sku: null, barcode: null, packedQuantity: 5 }] },
      order: { ...shipment.order, items: [...items, { id: "c", sku: "OTHER", name: "Drugi paket", qty: 100 }] },
      pickupBatchLines: [
        { providerParcelNumber: "AAA0850300002", packedItems: [{ ...packages[0].packedItems![0], name: "Drugi paket" }] },
        { providerParcelNumber: code, packedItems: packages[0].packedItems },
      ],
    });
    expect(html).toContain(items[0].name);
    expect(html).toContain(items[1].name);
    expect(html).not.toContain("Drugi paket");
    expect(html).not.toContain("2 stavki");
  });

  it("restores legacy batch labels with no direct tracking links using the original package order", () => {
    const html = renderXExpressLabelsHtml({ ...shipment,
      rawCreateResponse: { articleLabels: [{ Code: code, name: "POMPEA · 2 stavki · 5 kom", sku: null, barcode: null }] },
      pickupBatchLines: [{ providerParcelNumber: null, packageNo: 1, packedItems: packages[0].packedItems }],
    });
    expect(html).toContain(items[0].name);
    expect(html).toContain(items[1].name);
    expect(html).toContain("U kutiji: 5 kom");
  });

  it("keeps legacy mixed-order contents on the matching parcel when picking rows arrive out of order", () => {
    const html = renderXExpressLabelsHtml({ ...shipment, packageCount: 3,
      providerParcelNumbers: [code, "AAA0850300002", "AAA0850300003"],
      pickupBatchLines: [
        { providerParcelNumber: null, packageNo: 3, packedItems: null },
        { providerParcelNumber: null, packageNo: 1, packedItems: packages[0].packedItems },
        { providerParcelNumber: null, packageNo: 2, packedItems: null },
      ],
    });
    const labels = [...html.matchAll(/<section class="label">([\s\S]*?)<\/section>/g)].map(match => match[1]);
    expect(labels).toHaveLength(3);
    expect(labels[0]).toContain('class="packing-list"');
    expect(labels[0]).toContain(items[1].name);
    expect(labels[1]).not.toContain('class="packing-list"');
    expect(labels[2]).not.toContain('class="packing-list"');
  });

  it("preserves a long list and escapes names and SKUs without adding labels", () => {
    const packedItems = Array.from({ length: 24 }, (_, i) => ({ ...packages[0].packedItems![0], orderItemId: `item-${i}`, sku: `<${i}>`, name: `POMPEA <artikl & ${i}> dug naziv veličina XL boja crna` }));
    const html = renderXExpressLabelsHtml({ ...shipment, pickupBatchLines: [{ providerParcelNumber: code, packedItems }] });
    expect(html.match(/<section class="label">/g)).toHaveLength(1);
    expect(html.match(/class="packing-item"/g)).toHaveLength(24);
    expect(html).toContain("&lt;artikl &amp; 23&gt;");
    expect(html).toContain("Šifra: &lt;23&gt;");
    expect(html).not.toContain("<artikl");
  });
});
