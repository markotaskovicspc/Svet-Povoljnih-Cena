import { describe, expect, it, vi } from "vitest";
import {
  buildCopiedArticleData,
  copyArticleRetailPrice,
  type ArticleCopySource,
} from "@/lib/admin/article-copy.server";
import type { Prisma } from "@prisma/client";

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

  it("prenosi pozitivnu MP cenu u aktivni maloprodajni cenovnik", async () => {
    const create = vi.fn().mockResolvedValue({ id: "entry-1" });
    const tx = {
      priceList: {
        findMany: vi.fn().mockResolvedValue([
          { id: "price-list-mp", code: "MP", currency: "RSD" },
        ]),
      },
      priceListEntry: {
        findFirst: vi.fn().mockResolvedValue(null),
        create,
      },
    } as unknown as Prisma.TransactionClient;

    await copyArticleRetailPrice(tx, "product-copy", {
      fullPrice: 32_856,
    } as ArticleCopySource);

    expect(create).toHaveBeenCalledOnce();
    const createData = create.mock.calls[0]?.[0]?.data;
    expect(createData).toMatchObject({
      priceListId: "price-list-mp",
      productId: "product-copy",
    });
    expect(Number(createData?.price)).toBe(32_856);
  });

  it("ne pravi MP stavku kada izvorna cena nije pozitivna", async () => {
    const tx = {
      priceList: { findMany: vi.fn() },
      priceListEntry: { findFirst: vi.fn(), create: vi.fn() },
    } as unknown as Prisma.TransactionClient;

    await expect(
      copyArticleRetailPrice(tx, "product-copy", {
        fullPrice: 0,
      } as ArticleCopySource),
    ).resolves.toBeNull();
    expect(tx.priceList.findMany).not.toHaveBeenCalled();
  });
});
