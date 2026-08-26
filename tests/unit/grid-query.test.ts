import { describe, expect, it } from "vitest";
import { filterAndSortGridRows, nextGridSorting } from "@/lib/admin/grid-query";

describe("ERP numeric filters", () => {
  it("matches a date filter against the whole Belgrade calendar day", () => {
    const rows = [
      { id: "same-day", values: { orderDate: "2026-08-26T18:33:11.074Z" } },
      {
        id: "utc-previous-day",
        values: { orderDate: "2026-08-25T22:30:00.000Z" },
      },
      {
        id: "local-previous-day",
        values: { orderDate: "2026-08-25T21:30:00.000Z" },
      },
      { id: "next-day", values: { orderDate: "2026-08-27T08:00:00.000Z" } },
    ];
    const filter = {
      id: "order-date",
      columnKey: "orderDate",
      operator: "equals" as const,
      value: "2026-08-26",
    };

    expect(
      filterAndSortGridRows(rows, ["orderDate"], "", [filter], []).map(
        (row) => row.id,
      ),
    ).toEqual(["same-day", "utc-previous-day"]);
  });

  it("treats before and after as calendar-day comparisons", () => {
    const rows = [
      { id: "before", values: { orderDate: "2026-08-25T10:00:00.000Z" } },
      { id: "same", values: { orderDate: "2026-08-26T20:00:00.000Z" } },
      { id: "after", values: { orderDate: "2026-08-27T10:00:00.000Z" } },
    ];
    const baseFilter = {
      id: "order-date",
      columnKey: "orderDate",
      value: "2026-08-26",
    };

    expect(
      filterAndSortGridRows(
        rows,
        ["orderDate"],
        "",
        [{ ...baseFilter, operator: "before" }],
        [],
      ).map((row) => row.id),
    ).toEqual(["before"]);
    expect(
      filterAndSortGridRows(
        rows,
        ["orderDate"],
        "",
        [{ ...baseFilter, operator: "after" }],
        [],
      ).map((row) => row.id),
    ).toEqual(["after"]);
  });

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
      filterAndSortGridRows(
        rows,
        ["incoming"],
        "",
        [],
        [{ columnKey: "incoming", direction: "desc" }],
      ).map((row) => row.id),
    ).toEqual(["hundred", "ten", "zero"]);
  });

  it("cycles a column through ascending, descending and unsorted", () => {
    const ascending = nextGridSorting([], "incoming");
    const descending = nextGridSorting(ascending, "incoming");
    const unsorted = nextGridSorting(descending, "incoming");

    expect(ascending).toEqual([{ columnKey: "incoming", direction: "asc" }]);
    expect(descending).toEqual([{ columnKey: "incoming", direction: "desc" }]);
    expect(unsorted).toEqual([]);
  });

  it("replaces the previous column when a different header is clicked", () => {
    expect(
      nextGridSorting([{ columnKey: "incoming", direction: "desc" }], "sku"),
    ).toEqual([{ columnKey: "sku", direction: "asc" }]);
  });

  it("keeps equal incoming quantities stable in both directions", () => {
    const rows = [
      { id: "first", values: { incoming: 10 } },
      { id: "second", values: { incoming: 10 } },
      { id: "third", values: { incoming: 5 } },
    ];

    expect(
      filterAndSortGridRows(
        rows,
        ["incoming"],
        "",
        [],
        [{ columnKey: "incoming", direction: "asc" }],
      ).map((row) => row.id),
    ).toEqual(["third", "first", "second"]);
    expect(
      filterAndSortGridRows(
        rows,
        ["incoming"],
        "",
        [],
        [{ columnKey: "incoming", direction: "desc" }],
      ).map((row) => row.id),
    ).toEqual(["first", "second", "third"]);
  });

  it("sorts the complete result before a caller slices a later page", () => {
    const rows = Array.from({ length: 205 }, (_, index) => ({
      id: String(index),
      values: { incoming: index },
    }));
    const sorted = filterAndSortGridRows(
      rows,
      ["incoming"],
      "",
      [],
      [{ columnKey: "incoming", direction: "desc" }],
    );

    expect(sorted.slice(0, 3).map((row) => row.values.incoming)).toEqual([
      204, 203, 202,
    ]);
    expect(sorted.slice(100, 103).map((row) => row.values.incoming)).toEqual([
      104, 103, 102,
    ]);
  });

  it("combines incoming sorting with search and numeric filters", () => {
    const rows = [
      { id: "a", values: { sku: "LAMP-A", incoming: 100 } },
      { id: "b", values: { sku: "LAMP-B", incoming: 10 } },
      { id: "c", values: { sku: "CHAIR-C", incoming: 50 } },
      { id: "d", values: { sku: "LAMP-D", incoming: 0 } },
    ];

    expect(
      filterAndSortGridRows(
        rows,
        ["sku", "incoming"],
        "lamp",
        [
          {
            id: "positive",
            columnKey: "incoming",
            operator: "gt",
            value: "0",
          },
        ],
        [{ columnKey: "incoming", direction: "asc" }],
      ).map((row) => row.id),
    ).toEqual(["b", "a"]);
  });
});
