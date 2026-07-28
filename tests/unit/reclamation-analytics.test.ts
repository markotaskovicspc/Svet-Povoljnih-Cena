import { describe, expect, it } from "vitest";
import {
  buildReclamationAnalytics,
  type ReclamationAnalyticsRow,
} from "@/lib/admin/reclamation-analytics";

const NOW = new Date("2026-07-28T12:00:00.000Z");

function reclamation(
  overrides: Partial<ReclamationAnalyticsRow> & Pick<ReclamationAnalyticsRow, "id">,
): ReclamationAnalyticsRow {
  return {
    id: overrides.id,
    sku: "SKU-1",
    status: "PRIMLJENO",
    type: "KVAR",
    resolution: null,
    createdAt: new Date("2026-07-27T12:00:00.000Z"),
    resolvedAt: null,
    productName: "Lampa",
    supplier: "Rabalux",
    ...overrides,
  };
}

describe("reclamation analytics", () => {
  it("calculates headline, breakdown and cumulative ageing metrics", () => {
    const analytics = buildReclamationAnalytics(
      [
        reclamation({
          id: "open-31",
          createdAt: new Date("2026-06-27T11:59:59.000Z"),
        }),
        reclamation({
          id: "open-11",
          type: "FIZICKO_OSTECENJE",
          createdAt: new Date("2026-07-17T11:59:59.000Z"),
        }),
        reclamation({
          id: "resolved",
          status: "RESENO",
          resolution: "ZAMENA_ARTIKLA",
          createdAt: new Date("2026-07-20T12:00:00.000Z"),
          resolvedAt: new Date("2026-07-24T12:00:00.000Z"),
        }),
        reclamation({
          id: "rejected",
          status: "ODBIJENO",
          type: null,
          createdAt: new Date("2026-07-20T12:00:00.000Z"),
          resolvedAt: new Date("2026-07-26T12:00:00.000Z"),
        }),
      ],
      [{ supplier: "Rabalux", deliveredItems: 200 }],
      [{ sku: "SKU-1", deliveredItems: 200 }],
      NOW,
    );

    expect(analytics.totals).toMatchObject({
      total: 4,
      deliveredItems: 200,
      reclamationRate: 2,
      resolved: 2,
      unresolved: 2,
      unresolvedOver5Days: 2,
      unresolvedOver10Days: 2,
      unresolvedOver20Days: 1,
      unresolvedOver30Days: 1,
      averageResolutionDays: 5,
    });
    expect(analytics.totals.byType).toEqual([
      { key: "KVAR", count: 2 },
      { key: "FIZICKO_OSTECENJE", count: 1 },
      { key: "NIJE_UNETO", count: 1 },
    ]);
    expect(analytics.totals.byResolution).toContainEqual({
      key: "NIJE_UNETO",
      count: 3,
    });
  });

  it("calculates the same metrics per supplier and ranks only the top 20 SKUs", () => {
    const rows = Array.from({ length: 22 }, (_, index) =>
      reclamation({
        id: `claim-${index}`,
        sku: `SKU-${String(index).padStart(2, "0")}`,
        supplier: index % 2 === 0 ? "Rabalux" : "Eglo",
        productName: `Artikal ${index}`,
      }),
    );
    rows.push(
      reclamation({
        id: "second-claim",
        sku: "SKU-05",
        supplier: "Eglo",
        productName: "Artikal 5",
      }),
    );

    const analytics = buildReclamationAnalytics(
      rows,
      [
        { supplier: "Rabalux", deliveredItems: 100 },
        { supplier: "Eglo", deliveredItems: 50 },
      ],
      [{ sku: "SKU-05", deliveredItems: 10 }],
      NOW,
    );

    expect(analytics.suppliers).toHaveLength(2);
    expect(analytics.suppliers.find((row) => row.supplier === "Eglo")).toMatchObject({
      total: 12,
      deliveredItems: 50,
      reclamationRate: 24,
    });
    expect(analytics.topProducts).toHaveLength(20);
    expect(analytics.topProducts[0]).toMatchObject({
      sku: "SKU-05",
      reclamations: 2,
      deliveredItems: 10,
      reclamationRate: 20,
    });
  });

  it("returns a zero rate and no average when no items were delivered or resolved", () => {
    const analytics = buildReclamationAnalytics(
      [reclamation({ id: "only" })],
      [],
      [],
      NOW,
    );

    expect(analytics.totals.reclamationRate).toBe(0);
    expect(analytics.totals.averageResolutionDays).toBeNull();
  });
});
