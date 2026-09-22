import { describe, expect, it } from "vitest";
import { buildXExpressArticleLabels, resolveXExpressArticleLabel } from "@/lib/x-express/article-labels";
import { renderXExpressBatchLabelsHtml, renderXExpressLabelsHtml, type XExpressLabelShipment } from "@/lib/x-express/labels";

const items = [
  { id: "dc", name: "Stona lampa", qty: 2, sku: "001234", product: { barcode: "0012345678905" } },
  { id: "supplier", name: "Stona lampa", qty: 1, sku: "RAB-123", product: { barcode: "5998250398767" } },
];
const codes = ["AAA0850300001", "AAA0850300002"];
const packages = ["supplier", "dc"].map((orderItemId, index) => ({
  orderItemId, packageNo: index + 1, content: "Stona lampa",
  weightKg: 1, widthCm: 20, depthCm: 20, heightCm: 20,
}));
const shipment: XExpressLabelShipment = {
  id: "test-label", trackingNo: codes[0], packageCount: 2,
  providerParcelNumbers: codes, providerRouteCode: "BG-ZE-4", providerRouteName: null,
  rawCreateResponse: null, createdAt: new Date("2026-09-22T12:00:00Z"), purpose: "ORDER_DELIVERY",
  order: {
    number: "QA-1", total: 1200, paymentMethod: "POUZECE_GOTOVINA",
    shipFirstName: "Petar", shipLastName: "Petrovic", shipPhone: "0601234567",
    shipStreet: "Test ulica 10", shipCity: "Beograd", shipPostalCode: "11000", notes: null,
    items,
  },
};

describe("X Express article identification", () => {
  it("binds duplicate names to their exact package and renders snapshots by tracking code", () => {
    const articleLabels = buildXExpressArticleLabels({ codes, packages, items, purpose: "ORDER_DELIVERY" });
    expect(articleLabels.map((label) => label.sku)).toEqual(["RAB-123", "001234"]);
    const html = renderXExpressLabelsHtml({ ...shipment, rawCreateResponse: { articleLabels: [...articleLabels].reverse() } });
    const labels = [...html.matchAll(/<section class="label">([\s\S]*?)<\/section>/g)].map((match) => match[1]);
    expect(labels[0]).toContain("Šifra:</strong> RAB-123");
    expect(labels[0]).toContain('aria-label="Barkod artikla 5998250398767"');
    expect(labels[0]).not.toContain("0012345678905");
    expect(labels[1]).toContain("Šifra:</strong> 001234");
    expect(labels[1]).toContain('aria-label="Barkod artikla 0012345678905"');
    expect(labels[1]).toContain("EAN: 0012345678905");
    expect(labels[0]).toContain(codes[0]);
    expect(labels[1]).toContain(codes[1]);
  });

  it("supports existing batch labels with explicit item IDs, without guessing between identical names", () => {
    const html = renderXExpressBatchLabelsHtml([shipment], {
      packageContentsByShipmentId: { [shipment.id]: ["Stona lampa", "Stona lampa"] },
      packageOrderItemIdsByShipmentId: { [shipment.id]: ["supplier", "dc"] },
    });
    expect(html).toContain("EAN: 5998250398767");
    expect(html).toContain("EAN: 0012345678905");
    expect(resolveXExpressArticleLabel({ raw: null, code: codes[0], items, content: "Stona lampa" })).toBeNull();
  });

  it("limits a legacy supplier label to the assigned supplier item in a mixed order", () => {
    const resolved = resolveXExpressArticleLabel({
      raw: { assignment: { orderItemIds: ["supplier"], codAmount: 0 } },
      code: codes[0], items, content: "Stona lampa",
    });
    expect(resolved?.sku).toBe("RAB-123");
  });

  it("recognizes a legacy provider-truncated name but never uses an unrelated single item", () => {
    const item = { ...items[0], name: "Rabalux zidna lampa za kupatilo sa veoma dugackim nazivom modela" };
    expect(resolveXExpressArticleLabel({ raw: null, code: codes[0], items: [item], content: item.name.slice(0, 50).trim() })?.sku).toBe("001234");
    expect(resolveXExpressArticleLabel({ raw: null, code: codes[0], items: [item], content: "Stolica" })).toBeNull();
  });

  it("preserves spare-part descriptions without printing the whole product barcode", () => {
    const articleLabels = buildXExpressArticleLabels({ codes: [codes[0]], packages: [{ ...packages[0], content: "Ukrasna maska" }], items, purpose: "RECLAMATION_REPLACEMENT" });
    const html = renderXExpressBatchLabelsHtml([{ ...shipment, packageCount: 1, providerParcelNumbers: [codes[0]], rawCreateResponse: { articleLabels }, purpose: "RECLAMATION_REPLACEMENT" }], {
      packageContentsByShipmentId: { [shipment.id]: ["Stona lampa"] },
    });
    expect(html).toContain("Sadržaj:</strong> Ukrasna maska");
    expect(html).not.toContain("5998250398767");
  });

  it("prints the SKU without inventing an EAN and escapes catalogue text", () => {
    const html = renderXExpressLabelsHtml({ ...shipment, packageCount: 1, providerParcelNumbers: [codes[0]], order: { ...shipment.order, items: [{ name: '<img src=x onerror="alert(1)">', qty: 1, sku: "000007", product: null }] } });
    expect(html).toContain("Šifra:</strong> 000007");
    expect(html).toContain("EAN nije unet");
    expect(html).toContain("&lt;img");
    expect(html).not.toContain("<img");
  });
});
