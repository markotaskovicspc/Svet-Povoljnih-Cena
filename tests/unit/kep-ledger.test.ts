import { describe, expect, it } from "vitest";
import { ERP_REQUIREMENTS } from "@/lib/admin/erp-requirements";
import {
  dispatchAccountingDate,
  fiscalLevelingDifference,
  isAnanasName,
  priceChangeLevelingDifference,
  receiptAccountingDate,
} from "@/lib/admin/kep-ledger";
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

  it("uses the date from the posted goods receipt instead of the later posting date", () => {
    const receiptDate = new Date("2026-03-01T00:00:00.000Z");
    const snapshotDate = new Date("2026-11-09T12:00:00.000Z");
    const postedAt = new Date("2026-11-09T12:05:00.000Z");

    expect(receiptAccountingDate({ receiptDate, snapshotBookedAt: snapshotDate, postedAt }))
      .toBe(receiptDate);
    expect(receiptAccountingDate({ receiptDate: null, snapshotBookedAt: snapshotDate, postedAt }))
      .toBe(snapshotDate);
  });

  it("dates Ananas transfer entries by actual dispatch and recognizes internal Ananas destinations", () => {
    const actualDispatchAt = new Date("2026-10-13T17:54:00.000Z");
    const issueDate = new Date("2026-10-13T00:00:00.000Z");
    const postedAt = new Date("2026-10-13T17:58:00.000Z");

    expect(dispatchAccountingDate({
      actualDispatchAt,
      issueDate,
      snapshotBookedAt: postedAt,
      postedAt,
    })).toBe(actualDispatchAt);
    expect(isAnanasName("Magacin Ananas" )).toBe(true);
    expect(isAnanasName("Distributivni centar")).toBe(false);
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
