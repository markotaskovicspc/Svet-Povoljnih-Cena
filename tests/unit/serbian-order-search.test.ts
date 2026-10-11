import { describe, expect, it } from "vitest";
import { filterAndSortGridRows, gridValueMatchesFilter } from "@/lib/admin/grid-query";

describe("Serbian customer names in order search", () => {
  const rows = [
    { id: "accented", values: { customer: "Petar Šimić", city: "Čačak", total: 200 } },
    { id: "plain", values: { customer: "Petar Simic", city: "Cacak", total: 100 } },
    { id: "other", values: { customer: "Marko Petrović", city: "Niš", total: 300 } },
  ];

  it.each(["simic", "simić", "ŠIMIĆ", "Симић", "Simic\u0301"])(
    "finds both spellings with %s, before pagination and with sorting",
    (query) => {
      const result = filterAndSortGridRows(rows, ["customer"], query, [], [
        { columnKey: "total", direction: "asc" },
      ]);
      expect(result.map((row) => row.id)).toEqual(["plain", "accented"]);
      expect(result.slice(1, 2)[0].values.customer).toBe("Petar Šimić");
    },
  );

  it.each(["Đorđević", "Djordjevic", "Dordevic", "Ђорђевић"])(
    "treats đ, dj and d alike for %s",
    (query) => {
      const names = ["Đorđević", "Djordjevic", "Dordevic"];
      const customers = names.map((customer) => ({ id: customer, values: { customer } }));
      expect(filterAndSortGridRows(customers, ["customer"], query, [], [])).toEqual(customers);
    },
  );

  it.each(["contains", "not_contains", "equals", "not_equals"] as const)(
    "folds both sides of the %s text filter",
    (operator) => {
      const expected = !operator.startsWith("not_");
      for (const [actual, value] of [["Šimić", "simic"], ["Simic", "ŠIMIĆ"]]) {
        expect(gridValueMatchesFilter(actual, { id: "name", columnKey: "customer", operator, value })).toBe(expected);
      }
    },
  );

  it("preserves selected-column scope and combines name search with numeric filters", () => {
    expect(filterAndSortGridRows(rows, ["customer"], "cacak", [], [])).toEqual([]);
    expect(filterAndSortGridRows(rows, ["city"], "čačak", [], []).map((row) => row.id)).toEqual(["accented", "plain"]);
    expect(filterAndSortGridRows(rows, ["customer"], "simic", [
      { id: "total", columnKey: "total", operator: "gt", value: "150" },
    ], []).map((row) => row.id)).toEqual(["accented"]);
  });
});
