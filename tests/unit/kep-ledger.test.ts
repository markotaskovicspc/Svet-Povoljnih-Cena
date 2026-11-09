import { describe, expect, it } from "vitest";
import { ERP_REQUIREMENTS } from "@/lib/admin/erp-requirements";
import { fiscalLevelingDifference, priceChangeLevelingDifference } from "@/lib/admin/kep-ledger";
import {
  buildRetailValueSnapshot,
  readRetailValueSnapshot,
  retailValueSnapshotTotal,
} from "@/lib/admin/retail-value-snapshot";

describe("KEP and retail price levelings", () => {
  it("captures each receipt at the full MP price and keeps a stable total", () => {
    const snapshot = buildRetailValueSnapshot({
      bookedAt: new Date("2026-11-09T12:00:00.000Z"),
      items: [
        { id: "line-a", productId: "product-a", sku: "110001", qty: 2 },
        { id: "line-b", productId: "product-b", sku: "110002", qty: 3 },
      ],
      priceByProductId: new Map([["product-a", 1250], ["product-b", 99.99]]),
    });

    expect(retailValueSnapshotTotal(snapshot)).toBe(2799.97);
    expect(readRetailValueSnapshot(snapshot)).toEqual(snapshot);
  });

  it("blocks a receipt when even one imported article lacks an active MP price", () => {
    expect(() => buildRetailValueSnapshot({
      bookedAt: new Date("2026-11-09T12:00:00.000Z"),
      items: [
        { id: "line-a", productId: "product-a", sku: "110001", qty: 2 },
        { id: "line-b", productId: "product-b", sku: "110002", qty: 1 },
      ],
      priceByProductId: new Map([["product-a", 100]]),
    })).toThrow(/110002/);
  });

  it("records markdowns as negative levelings and reverses them on refunds", () => {
    expect(fiscalLevelingDifference({ kind: "SALE", qty: 2, fullMpc: 100, actualMpc: 80 })).toBe(-40);
    expect(fiscalLevelingDifference({ kind: "REFUND", qty: 2, fullMpc: 100, actualMpc: 80 })).toBe(40);
  });

  it("applies a published MP price change to the quantity still on hand", () => {
    expect(priceChangeLevelingDifference({ qtyAtChange: 5, previousMpc: 100, nextMpc: 90 })).toBe(-50);
    expect(priceChangeLevelingDifference({ qtyAtChange: 5, previousMpc: 100, nextMpc: 110 })).toBe(50);
  });

  it("tracks the KEP section as implemented against the client request", () => {
    expect(ERP_REQUIREMENTS.find((requirement) => requirement.acceptance === "ACC-06")).toMatchObject({
      status: "implemented",
      route: "/admin/erp/racunovodstveni-registri",
    });
  });
});

// Acceptance: ACC-06
