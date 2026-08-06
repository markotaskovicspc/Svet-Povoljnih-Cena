import { describe, expect, it } from "vitest";
import { selectSearchFamilyRepresentatives } from "@/lib/api/search";

describe("family-aware search", () => {
  it("deduplira generičke rezultate na glavnu boju porodice", () => {
    const result = selectSearchFamilyRepresentatives([
      {
        sku: "SOFA-BROWN",
        family_id: "sofa-family",
        is_family_primary: false,
      },
      {
        sku: "SOFA-GREY",
        family_id: "sofa-family",
        is_family_primary: true,
      },
      {
        sku: "TABLE-1",
        family_id: null,
        is_family_primary: false,
      },
    ]);

    expect(result.map((row) => row.sku)).toEqual(["SOFA-GREY", "TABLE-1"]);
  });
});
