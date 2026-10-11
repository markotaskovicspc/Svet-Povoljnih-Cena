import { describe, expect, it } from "vitest";
import { createImportMatcher, type ImportCatalogProduct } from "@/lib/admin/order-import/matching";
const line = (name: string, sku="") => ({ name, sku, qty: 1, unitPrice: null });
const products: ImportCatalogProduct[] = [
  { sku:"oven", name:"Rerna BAKE MASTER", shortDescription:"Mini električna rerna", attribute1:"12 L 1200 W" },
  { sku:"oven18", name:"Rerna BAKE MASTER PLUS", attribute1:"18 L 1500 W" },
  { sku:"white", name:"URBAN SEAT", shortDescription:"Trpezarijska stolica", colorPrimary:"bela" },
  { sku:"black", name:"URBAN SEAT", shortDescription:"Trpezarijska stolica", colorPrimary:"crna" },
  { sku:"mop", name:"POWER MOP", shortDescription:"Set za čišćenje poda" },
  { sku:"vacuum", name:"SMART CLEAN", shortDescription:"Ručni usisivač", barcode:"8601234567890" },
];
describe("catalog-wide order matching", () => {
  it("ranks model/spec agreement first rather than catalog alphabetic order", () => {
    const found=createImportMatcher(products)(line("Mini rerna BAKE MASTER 12 L 1200 W"));
    expect(found[0].sku).toBe("oven");
    expect(found[0].score).toBeGreaterThan(found.find(p=>p.sku==="oven18")?.score??0);
  });
  it("understands additive power attributes without falsely rejecting the total", () => {
    const match=createImportMatcher([{ sku:"oven", name:"Rerna BAKE MASTER", attribute1:"600W + 600W" }]);
    expect(match(line("Rerna BAKE MASTER 1200 W"))[0].reason).not.toContain("Razlika");
  });
  it("tolerates OCR mistakes and matches all catalog models, not a named product exception", () => {
    const match=createImportMatcher(products);
    expect(match(line("POWER M0P set za ciscenje"))[0].sku).toBe("mop");
    expect(match(line("URBAN SEET bela stolica"))[0].sku).toBe("white");
    expect(match(line("urbanseat bela stolica"))[0].sku).toBe("white");
    expect(match(line("Ручни усисивач SMART CLEAN"))[0].sku).toBe("vacuum");
    expect(match(line("rucni usisvac"))[0].sku).toBe("vacuum");
  });
  it("uses color metadata and penalizes a conflicting variant", () => {
    const found=createImportMatcher(products)(line("Bela stolica urban seat"));
    expect(found[0].sku).toBe("white");
    expect(found[0].matchKind).toBe("suggested");
    expect(found[1].sku).toBe("black");
    expect(found[1].confidence).toBe("low");
  });
  it("searches beyond the first alphabetic candidates in a large catalog", () => {
    const catalog = Array.from({ length: 5000 }, (_, i) => ({ sku: `lamp-${i}`, name: `Lampa MODEL ${i}`, colorPrimary: "crna" }));
    const start = performance.now();
    const found = createImportMatcher([...catalog, ...products])(line("POWER MOP set za ciscenje"));
    expect(found[0].sku).toBe("mop");
    console.log(`Catalog ranking, 5006 products: ${Math.round(performance.now()-start)} ms`);
  });
  it("labels ties as uncertain and never claims that a suggestion is exact", () => {
    const found=createImportMatcher(products)(line("URBAN SEAT stolica"));
    expect(found[0].confidence).toBe("low");
    expect(found[1].confidence).toBe("low");
    expect(found[0].matchKind).toBe("suggested");
    expect(createImportMatcher(products)(line("URBAN SEAT"))[0]).toMatchObject({ confidence: "low", matchKind: "suggested" });
  });
  it("prioritizes real SKU/barcode and does not treat an invented SKU as verified", () => {
    const match=createImportMatcher(products);
    expect(match(line("Rerna", "vacuum"))[0]).toMatchObject({sku:"vacuum",matchKind:"exact"});
    expect(match(line("8601234567890"))[0]).toMatchObject({sku:"vacuum",matchKind:"exact"});
    expect(match(line("POWER MOP", "unknown"))[0]).toMatchObject({sku:"mop"});
    expect(match(line("sasvim nepoznato qzxv"))).toEqual([]);
  });
});
