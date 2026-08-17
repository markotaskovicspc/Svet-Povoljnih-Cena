import { describe, expect, it } from "vitest";
import {
  resolveRabaluxWeeklyStockPolicy,
  shouldReconcileMissingCatalogProducts,
} from "@/lib/rabalux/weekly-stock-policy";

const ready = {
  supplierApprovalStatus: "APPROVED",
  articleStatus: "SP",
  hasCategory: true,
  hasReadyImage: true,
  hasActiveRetailPrice: true,
};

describe("Rabalux weekly stock publication policy", () => {
  it("keeps 0–9 visible but unavailable and allows purchasing at 10", () => {
    expect(
      resolveRabaluxWeeklyStockPolicy({ ...ready, closingStock: 0 }),
    ).toMatchObject({ isActive: true, availableWebAuto: false });
    expect(
      resolveRabaluxWeeklyStockPolicy({ ...ready, closingStock: 9 }),
    ).toMatchObject({ isActive: true, availableWebAuto: false });
    expect(
      resolveRabaluxWeeklyStockPolicy({ ...ready, closingStock: 10 }),
    ).toMatchObject({ isActive: true, availableWebAuto: true });
  });

  it("requires approval, category, retail price and a ready image", () => {
    expect(
      resolveRabaluxWeeklyStockPolicy({
        ...ready,
        closingStock: 20,
        hasReadyImage: false,
      }),
    ).toMatchObject({ isActive: false, availableWebAuto: false });
    expect(
      resolveRabaluxWeeklyStockPolicy({
        ...ready,
        closingStock: 20,
        articleStatus: "ARH",
      }),
    ).toMatchObject({ isActive: false, availableWebAuto: false });
  });
});

describe("Rabalux weekly catalog allow-list", () => {
  it("preserves XLSX products that are absent from the catalog feed", () => {
    expect(shouldReconcileMissingCatalogProducts(true)).toBe(false);
  });

  it("keeps legacy disappearance handling before the first weekly snapshot", () => {
    expect(shouldReconcileMissingCatalogProducts(false)).toBe(true);
  });
});
