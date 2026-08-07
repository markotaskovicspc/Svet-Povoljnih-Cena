import { describe, expect, it, vi } from "vitest";
import { propagateProductFamilySharedData } from "@/lib/product-family.server";

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
