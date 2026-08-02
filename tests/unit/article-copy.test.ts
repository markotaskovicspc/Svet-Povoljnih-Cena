import { describe, expect, it } from "vitest";
import {
  buildCopiedArticleData,
  type ArticleCopySource,
} from "@/lib/admin/article-copy.server";

describe("kopiranje artikla", () => {
  it("kopira matične podatke, ali dodeljuje novu šifru i resetuje operativno stanje", () => {
    const source = {
      name: "Baštenska stolica RELAX",
      shortName: "RELAX",
      shortDescription: "Baštenska stolica",
      description: "Opis stolice",
      widthCm: 54.5,
      depthCm: 61,
      heightCm: 88,
      fullPrice: 2_427,
      countryOfOrigin: "Kina",
      materialText: "Čelik i tekstilen",
      availableWebManual: true,
      availableWholesaleManual: true,
      availableExportManual: true,
      deliveryDaysMin: 3,
      deliveryDaysMax: 5,
      allowsAssembly: false,
      categories: [{ categoryId: "category-1" }],
      materials: [{ materialId: "material-1" }],
      pictograms: [],
      assemblyCities: [],
      lookupAssignments: [],
    } as unknown as ArticleCopySource;

    const copied = buildCopiedArticleData(source, {
      sku: "100123",
      slug: "100123-copy",
    });

    expect(copied).toMatchObject({
      sku: "100123",
      slug: "100123-copy",
      name: source.name,
      shortDescription: source.shortDescription,
      widthCm: source.widthCm,
      countryOfOrigin: "Kina",
      articleStatus: "UZ",
      isActive: false,
      stock: 0,
      incomingStock: 0,
      supplierStock: null,
      salePrice: null,
      actionId: null,
      barcode: null,
    });
    expect(copied).not.toHaveProperty("media");
    expect(copied).not.toHaveProperty("attachments");
  });
});
