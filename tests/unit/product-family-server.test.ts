import { describe, expect, it, vi } from "vitest";

const { syncArticleLookupAssignmentsMock } = vi.hoisted(() => ({
  syncArticleLookupAssignmentsMock: vi.fn().mockResolvedValue({}),
}));

vi.mock("@/lib/admin/article-master.server", () => ({
  syncArticleLookupAssignments: syncArticleLookupAssignmentsMock,
}));

import {
  addExistingProductToColorFamily,
  detachProductColorFamilyMember,
  propagateProductFamilySharedData,
  setProductColorFamilyPrimary,
  setProductFamilyMembership,
  updateProductFamilyMemberColors,
} from "@/lib/product-family.server";

describe("upravljanje članovima porodice boja", () => {
  it("odbija duplikat automatski izvedenog naziva boje", async () => {
    const upsertMember = vi.fn();
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      productFamily: {
        upsert: vi.fn().mockResolvedValue({
          id: "family-1",
          primaryProductId: "black",
        }),
      },
      productFamilyMember: {
        findUnique: vi.fn().mockResolvedValue(null),
        findFirst: vi.fn().mockResolvedValue({
          product: { sku: "SKU-BLACK" },
        }),
        upsert: upsertMember,
      },
    };

    await expect(
      setProductFamilyMembership(tx as never, {
        productId: "other-black",
        familyCode: "CHAIRS",
        label: "Crna",
      }),
    ).rejects.toThrow("SKU-BLACK");
    expect(upsertMember).not.toHaveBeenCalled();
  });

  it("postavlja izabrani postojeći član kao glavnu boju", async () => {
    const updateFamily = vi.fn().mockResolvedValue({});
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      productFamilyMember: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({ familyId: "family-1" }),
      },
      productFamily: {
        findUnique: vi.fn().mockResolvedValue({
          primaryProductId: "black",
          members: [{ productId: "black" }, { productId: "white" }],
        }),
        update: updateFamily,
      },
    };

    await setProductColorFamilyPrimary(tx as never, "white");

    expect(updateFamily).toHaveBeenCalledWith({
      where: { id: "family-1" },
      data: { primaryProductId: "white" },
    });
  });

  it("odvaja članstvo bez brisanja artikla i normalizuje glavnu boju", async () => {
    const deleteMembership = vi.fn().mockResolvedValue({});
    const deleteFamily = vi.fn();
    const updateFamily = vi.fn().mockResolvedValue({});
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      productFamilyMember: {
        findUnique: vi.fn().mockResolvedValue({ familyId: "family-1" }),
        delete: deleteMembership,
        count: vi.fn().mockResolvedValue(1),
      },
      productFamily: {
        findUnique: vi.fn().mockResolvedValue({
          primaryProductId: "detached",
          members: [{ productId: "remaining" }],
        }),
        update: updateFamily,
        delete: deleteFamily,
      },
      product: { delete: vi.fn() },
    };

    await detachProductColorFamilyMember(tx as never, "detached");

    expect(deleteMembership).toHaveBeenCalledWith({
      where: { productId: "detached" },
    });
    expect(updateFamily).toHaveBeenCalledWith({
      where: { id: "family-1" },
      data: { primaryProductId: "remaining" },
    });
    expect(deleteFamily).not.toHaveBeenCalled();
    expect(tx.product.delete).not.toHaveBeenCalled();
  });

  it("povezuje postojeći SKU bez menjanja njegove cene, stanja i medija", async () => {
    syncArticleLookupAssignmentsMock.mockClear();
    const updateProduct = vi.fn().mockResolvedValue({});
    const target = {
      id: "white",
      sku: "SKU-WHITE",
      deletedAt: null,
      attribute1: "Atribut",
      attribute2: null,
      attribute3: null,
      attribute4: null,
      lookupAssignments: [],
      familyMembership: null,
    };
    const sourceMembership = {
      familyId: "family-1",
      label: "Crna",
      colorHex: null,
      position: 0,
      storefrontEnabled: true,
      family: { code: "SKU-BLACK", primaryProductId: "black" },
    };
    const sharedSource = {
      name: "Artikal",
      shortName: "Artikal",
      description: "Opis",
      shortDescription: "Kratak opis",
      categories: [],
      materials: [],
      pictograms: [],
      assemblyCities: [],
      attachments: [],
      lookupAssignments: [],
    };
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      product: {
        findUniqueOrThrow: vi
          .fn()
          .mockResolvedValueOnce(target)
          .mockResolvedValueOnce({
            id: "black",
            sku: "SKU-BLACK",
            colorPrimary: "Crna",
            colorSecondary: null,
            familyMembership: sourceMembership,
          })
          .mockResolvedValueOnce(sharedSource),
        findMany: vi.fn().mockResolvedValue([{ id: "white", sku: "SKU-WHITE" }]),
        update: updateProduct,
      },
      productFamilyMember: {
        findUnique: vi
          .fn()
          .mockResolvedValueOnce({ familyId: "family-1" })
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({
            familyId: "family-1",
            family: {
              primaryProductId: "black",
              members: [{ productId: "black" }, { productId: "white" }],
            },
          }),
        findFirst: vi
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({ position: 0 })
          .mockResolvedValueOnce(null),
        upsert: vi
          .fn()
          .mockResolvedValueOnce({ familyId: "family-1" })
          .mockResolvedValueOnce({ familyId: "family-1" }),
      },
      productFamily: {
        upsert: vi.fn().mockResolvedValue({
          id: "family-1",
          primaryProductId: "black",
        }),
        findUnique: vi.fn().mockResolvedValue({
          primaryProductId: "black",
          members: [{ productId: "black" }, { productId: "white" }],
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      productCategory: { deleteMany: vi.fn() },
      productMaterial: { deleteMany: vi.fn() },
      productPictogram: { deleteMany: vi.fn() },
      productAssemblyCity: { deleteMany: vi.fn() },
      productAttachment: { deleteMany: vi.fn() },
      productLookupAssignment: {
        findMany: vi.fn().mockResolvedValue([]),
        deleteMany: vi.fn(),
      },
    };

    await addExistingProductToColorFamily(tx as never, {
      sourceProductId: "black",
      targetProductId: "white",
      colorPrimary: "Bela",
      colorSecondary: null,
    });

    expect(syncArticleLookupAssignmentsMock).toHaveBeenCalledWith(
      tx,
      "white",
      expect.objectContaining({ colors: ["Bela", null] }),
    );
    expect(updateProduct).toHaveBeenCalledWith({
      where: { id: "white" },
      data: { colorPrimary: "Bela", colorSecondary: null },
    });
    for (const call of updateProduct.mock.calls) {
      const data = call[0].data;
      expect(data).not.toHaveProperty("fullPrice");
      expect(data).not.toHaveProperty("salePrice");
      expect(data).not.toHaveProperty("stock");
      expect(data).not.toHaveProperty("media");
      expect(data).not.toHaveProperty("actionId");
    }
  });

  it("menja boje iz porodičnog panela i atomarno osvežava naziv člana", async () => {
    syncArticleLookupAssignmentsMock.mockClear();
    const updateProduct = vi.fn().mockResolvedValue({});
    const upsertMember = vi.fn().mockResolvedValue({ id: "member-gray" });
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      product: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          attribute1: "LED",
          attribute2: null,
          attribute3: null,
          attribute4: null,
          lookupAssignments: [
            { lookupValue: { kind: "BENEFIT", value: "5 godina garancije" } },
            { lookupValue: { kind: "CERTIFICATE", value: "CE" } },
          ],
        }),
        update: updateProduct,
      },
      productFamilyMember: {
        findUnique: vi
          .fn()
          .mockResolvedValueOnce({
            family: { code: "NOAH" },
            colorHex: null,
            position: 3,
            storefrontEnabled: true,
          })
          .mockResolvedValueOnce({ familyId: "family-1" }),
        findFirst: vi.fn().mockResolvedValue(null),
        upsert: upsertMember,
      },
      productFamily: {
        upsert: vi.fn().mockResolvedValue({
          id: "family-1",
          primaryProductId: "white",
        }),
        findUnique: vi.fn().mockResolvedValue({
          primaryProductId: "white",
          members: [{ productId: "white" }, { productId: "gray" }],
        }),
        update: vi.fn().mockResolvedValue({}),
      },
    };

    const result = await updateProductFamilyMemberColors(tx as never, {
      productId: "gray",
      colorPrimary: "Siva",
      colorSecondary: null,
    });

    expect(updateProduct).toHaveBeenCalledWith({
      where: { id: "gray" },
      data: { colorPrimary: "Siva", colorSecondary: null },
    });
    expect(syncArticleLookupAssignmentsMock).toHaveBeenCalledWith(tx, "gray", {
      attributes: ["LED", null, null, null],
      colors: ["Siva", null],
      benefits: ["5 godina garancije"],
      certificates: ["CE"],
    });
    expect(upsertMember).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ label: "Siva", labelKey: "siva" }),
      }),
    );
    expect(result.label).toBe("Siva");
  });
});

describe("propagateProductFamilySharedData", () => {
  it("zadržava cene, akcije i promotivne statuse na konkretnom SKU-u", async () => {
    const update = vi.fn().mockResolvedValue({ id: "target" });
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      productFamilyMember: {
        findUnique: vi.fn().mockResolvedValue({
          familyId: "family-1",
          family: {
            primaryProductId: "source",
            members: [{ productId: "source" }, { productId: "target" }],
          },
        }),
      },
      product: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          fullPrice: 2_000,
          salePrice: 1_500,
          discountPct: 25,
          loyaltyPrice: 1_400,
          loyaltyDiscountPct: 30,
          actionId: "action-1",
          articleStatus: "DTZ",
          isHero: true,
          isNew: true,
          newUntil: new Date("2026-09-01T00:00:00.000Z"),
          newUntilAutomatic: false,
          isLimited: false,
          isDtz: true,
          isActive: true,
          deletedAt: null,
          availableWebManual: true,
          availableWholesaleManual: false,
          availableExportManual: true,
          inGoogleMerchant: true,
          inMetaCatalog: false,
          inTiktokCatalog: true,
          categories: [],
          materials: [],
          pictograms: [],
          assemblyCities: [],
          attachments: [],
          lookupAssignments: [],
        }),
        findMany: vi.fn().mockResolvedValue([{ id: "target", sku: "SKU-2" }]),
        update,
      },
    };

    await propagateProductFamilySharedData(
      tx as never,
      "source",
      ["publication"],
    );

    expect(update).toHaveBeenCalledWith({
      where: { id: "target" },
      data: {
        availableWebManual: true,
        availableWholesaleManual: false,
        availableExportManual: true,
        inGoogleMerchant: true,
        inMetaCatalog: false,
        inTiktokCatalog: true,
      },
    });
  });
});
