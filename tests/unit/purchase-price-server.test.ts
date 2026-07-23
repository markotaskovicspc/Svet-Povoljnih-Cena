import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({
  productFindFirst: vi.fn(),
  purchasePriceCreate: vi.fn(),
  purchasePriceUpdate: vi.fn(),
  purchasePriceFindUnique: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    product: {
      findFirst: dbMocks.productFindFirst,
    },
    purchasePrice: {
      create: dbMocks.purchasePriceCreate,
      update: dbMocks.purchasePriceUpdate,
      findUnique: dbMocks.purchasePriceFindUnique,
    },
  },
}));

import {
  createPurchasePrice,
  updatePurchasePriceCell,
} from "@/lib/admin/purchase-price.server";

const article = {
  id: "product-1",
  sku: "SKU-001",
  name: "Test artikal",
  attribute1: "Masiv",
  attribute2: "Metal",
  attribute3: null,
  attribute4: null,
  sizeLabel: "80x40",
  colorPrimary: "Natur",
  colorSecondary: "Grafit",
  supplier: {
    id: "supplier-1",
    name: "Test dobavljač",
    currency: "EUR",
    parity: "DAP",
  },
};

describe("purchase-price server persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMocks.productFindFirst.mockResolvedValue(article);
    dbMocks.purchasePriceCreate.mockImplementation(async ({ data }) => ({
      id: "price-1",
      ...data,
    }));
    dbMocks.purchasePriceUpdate.mockResolvedValue({ id: "price-1" });
    dbMocks.purchasePriceFindUnique.mockResolvedValue({
      validFrom: new Date("2030-01-01T00:00:00.000Z"),
      validTo: new Date("2030-12-31T00:00:00.000Z"),
    });
  });

  it("creates a linked snapshot using article and supplier master data", async () => {
    const created = await createPurchasePrice({
      sku: " sku-001 ",
      purchasePrice: "123,45",
      validFrom: "2030-01-01",
      validTo: "2030-12-31",
    });

    expect(dbMocks.productFindFirst).toHaveBeenCalledWith({
      where: {
        sku: { equals: "sku-001", mode: "insensitive" },
        deletedAt: null,
      },
      select: expect.any(Object),
    });
    expect(dbMocks.purchasePriceCreate).toHaveBeenCalledWith({
      data: {
        productId: "product-1",
        supplierId: "supplier-1",
        sku: "SKU-001",
        name: "Test artikal",
        attributes: "Masiv / Metal",
        pattern: "Natur + Grafit",
        currency: "EUR",
        parity: "DAP",
        price: "123.45",
        validFrom: new Date("2030-01-01T00:00:00.000Z"),
        validTo: new Date("2030-12-31T00:00:00.000Z"),
      },
    });
    expect(created.sku).toBe("SKU-001");
  });

  it("supports an open-ended price period", async () => {
    await createPurchasePrice({
      sku: "SKU-001",
      purchasePrice: 0,
      validFrom: "2030-01-01",
      validTo: "",
    });

    expect(dbMocks.purchasePriceCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ price: "0", validTo: null }),
    });
  });

  it("validates price and dates before querying article data", async () => {
    await expect(
      createPurchasePrice({
        sku: "SKU-001",
        purchasePrice: "-1",
        validFrom: "2030-01-01",
      }),
    ).rejects.toThrow(/Nabavna cena/);
    await expect(
      createPurchasePrice({
        sku: "SKU-001",
        purchasePrice: "1",
        validFrom: "2030-02-30",
      }),
    ).rejects.toThrow(/ispravan datum/);

    expect(dbMocks.productFindFirst).not.toHaveBeenCalled();
    expect(dbMocks.purchasePriceCreate).not.toHaveBeenCalled();
  });

  it("rejects an unknown article", async () => {
    dbMocks.productFindFirst.mockResolvedValue(null);

    await expect(
      createPurchasePrice({
        sku: "UNKNOWN",
        purchasePrice: "1",
        validFrom: "2030-01-01",
      }),
    ).rejects.toThrow(/ne postoji u bazi artikala/);
    expect(dbMocks.purchasePriceCreate).not.toHaveBeenCalled();
  });

  it("rejects an article without a supplier", async () => {
    dbMocks.productFindFirst.mockResolvedValue({ ...article, supplier: null });

    await expect(
      createPurchasePrice({
        sku: "SKU-001",
        purchasePrice: "1",
        validFrom: "2030-01-01",
      }),
    ).rejects.toThrow(/nema povezanog dobavljača/);
  });

  it("rejects a supplier without a parity", async () => {
    dbMocks.productFindFirst.mockResolvedValue({
      ...article,
      supplier: { ...article.supplier, parity: " " },
    });

    await expect(
      createPurchasePrice({
        sku: "SKU-001",
        purchasePrice: "1",
        validFrom: "2030-01-01",
      }),
    ).rejects.toThrow(/nema unet paritet/);
  });

  it("rejects a supplier with a parity outside the controlled list", async () => {
    dbMocks.productFindFirst.mockResolvedValue({
      ...article,
      supplier: { ...article.supplier, parity: "XYZ" },
    });

    await expect(
      createPurchasePrice({
        sku: "SKU-001",
        purchasePrice: "1",
        validFrom: "2030-01-01",
      }),
    ).rejects.toThrow(/nema ispravan paritet/);
  });

  it("rebinding the SKU refreshes every automatic field", async () => {
    await expect(
      updatePurchasePriceCell("price-1", "sku", "sku-001"),
    ).resolves.toEqual({ value: "SKU-001", refreshRow: true });
    expect(dbMocks.purchasePriceUpdate).toHaveBeenCalledWith({
      where: { id: "price-1" },
      data: {
        productId: "product-1",
        supplierId: "supplier-1",
        sku: "SKU-001",
        name: "Test artikal",
        attributes: "Masiv / Metal",
        pattern: "Natur + Grafit",
        currency: "EUR",
        parity: "DAP",
      },
    });
  });

  it("updates a valid numeric price", async () => {
    await expect(
      updatePurchasePriceCell("price-1", "purchasePrice", "12,30"),
    ).resolves.toEqual({ value: 12.3 });
    expect(dbMocks.purchasePriceUpdate).toHaveBeenCalledWith({
      where: { id: "price-1" },
      data: { price: "12.30" },
    });
  });

  it("validates date edits against the other period boundary", async () => {
    await expect(
      updatePurchasePriceCell("price-1", "validFrom", "2031-01-01"),
    ).rejects.toThrow(/ne može biti pre/);
    await expect(
      updatePurchasePriceCell("price-1", "validTo", "2029-12-31"),
    ).rejects.toThrow(/ne može biti pre/);
    expect(dbMocks.purchasePriceUpdate).not.toHaveBeenCalled();
  });

  it("clears the optional end date and rejects protected fields", async () => {
    await expect(
      updatePurchasePriceCell("price-1", "validTo", null),
    ).resolves.toEqual({ value: null });
    expect(dbMocks.purchasePriceUpdate).toHaveBeenCalledWith({
      where: { id: "price-1" },
      data: { validTo: null },
    });

    vi.clearAllMocks();
    await expect(
      updatePurchasePriceCell("price-1", "currency", "$"),
    ).resolves.toBeNull();
    expect(dbMocks.purchasePriceUpdate).not.toHaveBeenCalled();
  });

  it("reports a missing row during a date edit", async () => {
    dbMocks.purchasePriceFindUnique.mockResolvedValue(null);

    await expect(
      updatePurchasePriceCell("missing", "validTo", null),
    ).rejects.toThrow(/ne postoji/);
  });
});
