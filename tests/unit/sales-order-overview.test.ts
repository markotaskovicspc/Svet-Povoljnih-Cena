import { describe, expect, it } from "vitest";
import {
  discountedSalesOrderLineTotals,
  summarizeSalesOrderRows,
} from "@/lib/admin/sales-order-overview";

describe("sales order overview totals", () => {
  it("allocates the first-purchase discount in cents across merchandise", () => {
    const totals = discountedSalesOrderLineTotals(
      [
        { id: "a", qty: 2, unitPrice: 1_000 },
        { id: "b", qty: 1, unitPrice: 500 },
      ],
      375,
    );

    expect(totals.get("a")).toEqual({
      discount: 300,
      totalGross: 1_700,
      totalNet: 1_416.67,
    });
    expect(totals.get("b")).toEqual({
      discount: 75,
      totalGross: 425,
      totalNet: 354.17,
    });
    expect(
      [...totals.values()].reduce((sum, row) => sum + row.discount, 0),
    ).toBe(375);
  });

  it("uses stable largest-remainder allocation for sub-cent shares", () => {
    const totals = discountedSalesOrderLineTotals(
      [
        { id: "a", qty: 1, unitPrice: 1 },
        { id: "b", qty: 1, unitPrice: 1 },
        { id: "c", qty: 1, unitPrice: 1 },
      ],
      0.01,
    );

    expect(totals.get("a")?.discount).toBe(0.01);
    expect(totals.get("b")?.discount).toBe(0);
    expect(totals.get("c")?.discount).toBe(0);
  });

  it("summarizes all filtered rows and counts distinct orders", () => {
    expect(
      summarizeSalesOrderRows([
        {
          id: "line-a",
          detailId: "order-1",
          values: { totalNet: 100, totalGross: 120 },
        },
        {
          id: "line-b",
          detailId: "order-1",
          values: { totalNet: 200, totalGross: 240 },
        },
        {
          id: "order-2",
          detailId: "order-2",
          values: { totalNet: 50, totalGross: 60 },
        },
      ]),
    ).toEqual({
      orderCount: 2,
      rowCount: 3,
      totalNet: 350,
      totalGross: 420,
    });
  });
});
