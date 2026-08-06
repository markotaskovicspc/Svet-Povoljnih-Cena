import { describe, expect, it } from "vitest";
import { paginateSearchSkuRows } from "@/lib/api/search";

describe("SKU-level search", () => {
  it("zadržava svaku boju porodice kao poseban rezultat", () => {
    const result = paginateSearchSkuRows([
      {
        sku: "SOFA-BROWN",
      },
      {
        sku: "SOFA-GREY",
      },
      {
        sku: "TABLE-1",
      },
    ], 0, 10);

    expect(result.map((row) => row.sku)).toEqual([
      "SOFA-BROWN",
      "SOFA-GREY",
      "TABLE-1",
    ]);
  });
});
