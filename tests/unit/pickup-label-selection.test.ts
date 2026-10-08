import { describe, expect, it } from "vitest";
import { pickupLabelArticles, pickupLabelSort, selectPickupLabels } from "@/lib/admin/pickup-label-selection";

const lines = [
  { id: "chair10", orderItem: { sku: "0010", name: "Žuta stolica" } },
  { id: "lamp", orderItem: { sku: "0100", name: "Lampa" } },
  { id: "chair2", orderItem: { sku: "0002", name: "Žuta stolica" } },
];

describe("physical label selection", () => {
  it("searches partial names and codes together, without case or accent sensitivity", () => {
    expect(selectPickupLabels(lines, " ZUTA 001 ", "order").map(l => l.id)).toEqual(["chair10"]);
    expect(selectPickupLabels(lines, "0002", "order").map(l => l.id)).toEqual(["chair2"]);
    expect(selectPickupLabels(lines, "nema", "order")).toEqual([]);
  });
  it("sorts names in Serbian and codes numerically while preserving source order", () => {
    expect(selectPickupLabels(lines, "", "name").map(l => l.id)).toEqual(["lamp", "chair2", "chair10"]);
    expect(selectPickupLabels(lines, "", "sku").map(l => l.id)).toEqual(["chair2", "chair10", "lamp"]);
    expect(selectPickupLabels(lines, "", "order")).toEqual(lines);
    expect(lines[0].id).toBe("chair10");
    expect(pickupLabelSort("invalid")).toBe("order");
  });
  it("finds any article in a combined box, without duplicating or splitting the box", () => {
    const packedItems = lines.map((l, i) => ({ ...l.orderItem, orderItemId: l.id, quantity: i + 1, barcode: null, categoryName: null, color1: null, color2: null, unitValue: 100 }));
    const mixed = { id: "mixed", orderItem: null, packedItems };
    expect(selectPickupLabels([mixed], "0002", "sku")).toEqual([mixed]);
    expect(selectPickupLabels([mixed], "stolica", "name")).toHaveLength(1);
    expect(pickupLabelArticles(mixed)).toHaveLength(3);
  });
  it("keeps spare-part descriptions and lets operators search the original article code", () => {
    const part = { ...lines[0], purpose: "RECLAMATION_REPLACEMENT", reclamation: { resolution: "ZAMENA_DELA", resolutionNote: "Naslon" } };
    expect(selectPickupLabels([part], "naslon 0010", "name")).toEqual([part]);
    expect(pickupLabelArticles(part)[0].name).toContain("NE SLATI CEO ARTIKAL");
  });
});
