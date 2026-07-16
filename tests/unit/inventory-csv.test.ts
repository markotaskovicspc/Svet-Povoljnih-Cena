import { describe, expect, it } from "vitest";
import { parseOpeningInventoryCsv } from "@/lib/inventory-csv";

describe("opening inventory CSV", () => {
  it("parses Serbian aliases and decimal values", () => {
    const result = parseOpeningInventoryCsv(
      "sifra;stanje;sirina;dubina;visina\nSKU-1;12;100.5;45;70\n",
    );
    expect(result.errors).toEqual([]);
    expect(result.rows).toEqual([
      { line: 2, sku: "SKU-1", qty: 12, widthCm: 100.5, depthCm: 45, heightCm: 70 },
    ]);
  });

  it("rejects duplicate SKUs and incomplete dimensions", () => {
    const result = parseOpeningInventoryCsv(
      "sku,qty,widthCm,depthCm,heightCm\nSKU-1,2,10,20,0\nSKU-1,3,10,20,30\n",
    );
    expect(result.rows).toEqual([]);
    expect(result.errors.join(" ")).toMatch(/dimenzije/i);
    expect(result.errors.join(" ")).toMatch(/ponavlja/i);
  });
});
