import { describe, expect, it } from "vitest";
import { filterAndSortGridRows } from "@/lib/admin/grid-query";

describe("ERP numeric filters", () => {
  it("applies the saved greater-than-zero operator to physical stock", () => {
    const rows = [
      { id: "zero", values: { physical: 0 } },
      { id: "positive", values: { physical: 4 } },
      { id: "negative", values: { physical: -2 } },
    ];

    expect(
      filterAndSortGridRows(
        rows,
        ["physical"],
        "",
        [
          {
            id: "physical-positive",
            columnKey: "physical",
            operator: "gt",
            value: "0",
          },
        ],
        [],
      ).map((row) => row.id),
    ).toEqual(["positive"]);
  });

  it("applies case-insensitive not-contains filtering to text columns", () => {
    const rows = [
      { id: "alpha", values: { name: "Relaxo Fotelja" } },
      { id: "beta", values: { name: "Cube sto" } },
      { id: "empty", values: { name: null } },
    ];

    expect(
      filterAndSortGridRows(
        rows,
        ["name"],
        "",
        [
          {
            id: "without-relaxo",
            columnKey: "name",
            operator: "not_contains",
            value: "RELAXO",
          },
        ],
        [],
      ).map((row) => row.id),
    ).toEqual(["beta", "empty"]);
  });

  it("sorts the incoming-stock column numerically", () => {
    const rows = [
      { id: "ten", values: { incoming: 10 } },
      { id: "zero", values: { incoming: 0 } },
      { id: "hundred", values: { incoming: 100 } },
    ];

    expect(
      filterAndSortGridRows(rows, ["incoming"], "", [], [
        { columnKey: "incoming", direction: "desc" },
      ]).map((row) => row.id),
    ).toEqual(["hundred", "ten", "zero"]);
  });
});
