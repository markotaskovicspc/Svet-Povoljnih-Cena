import { describe, expect, it } from "vitest";
import { validateNewArticleImportRequiredFields } from "@/lib/admin/article-import-required";

const completeRow = {
  description: "<p>Pun opis proizvoda.</p>",
  supplier: "Dobavljač",
  category: "Nameštaj",
  countryOfOrigin: "Srbija",
  hsCode: "9403",
  widthCm: 100,
  depthCm: 50,
  heightCm: 80,
  grossWeightKg: 24,
  packQty: 1,
  packWidthCm: 105,
  packDepthCm: 55,
  packHeightCm: 20,
  packGrossWeightKg: 26,
  retailPrice: 12_990,
};

describe("required master fields for a new article import", () => {
  it("accepts a complete operational master row", () => {
    expect(validateNewArticleImportRequiredFields(completeRow)).toEqual([]);
  });

  it("rejects missing master, package and retail-price data", () => {
    const issues = validateNewArticleImportRequiredFields({
      ...completeRow,
      description: "<p> </p>",
      supplier: null,
      category: null,
      countryOfOrigin: null,
      hsCode: null,
      widthCm: 0,
      grossWeightKg: null,
      packQty: 0,
      packWidthCm: null,
      packGrossWeightKg: 0,
      retailPrice: null,
    });

    expect(issues.map((issue) => issue.field)).toEqual([
      "description",
      "supplier",
      "category",
      "countryOfOrigin",
      "hsCode",
      "widthCm",
      "grossWeightKg",
      "packQty",
      "packWidthCm",
      "packGrossWeightKg",
      "retailPrice",
    ]);
  });
});
