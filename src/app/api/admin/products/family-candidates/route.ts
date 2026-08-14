import { NextResponse } from "next/server";
import { requireAdminAction } from "@/lib/admin";
import { db } from "@/lib/db";
import { productFamilyReadinessReasons } from "@/lib/product-family";
import { activeRetailPriceEntryWhere } from "@/lib/pricing/retail-price-write.server";
import { resolveSupabaseStorageUrl } from "@/lib/supabase/storage";
import { storefrontPublicationBlockers } from "@/lib/web-storefront-availability";

export async function GET(request: Request) {
  await requireAdminAction(["CONTENT", "OPS"]);
  const search = new URL(request.url).searchParams;
  const query = search.get("q")?.trim() ?? "";
  const sourceProductId = search.get("sourceProductId")?.trim() ?? "";
  if (query.length < 2 || !sourceProductId) {
    return NextResponse.json({ products: [] });
  }

  const now = new Date();
  const [sourceMembership, products] = await Promise.all([
    db.productFamilyMember.findUnique({
      where: { productId: sourceProductId },
      select: { familyId: true },
    }),
    db.product.findMany({
      where: {
        id: { not: sourceProductId },
        deletedAt: null,
        OR: [
          { sku: { contains: query, mode: "insensitive" } },
          { name: { contains: query, mode: "insensitive" } },
          { shortName: { contains: query, mode: "insensitive" } },
        ],
      },
      select: {
        id: true,
        sku: true,
        name: true,
        colorPrimary: true,
        colorSecondary: true,
        isActive: true,
        deletedAt: true,
        availableWebManual: true,
        availableWebAuto: true,
        articleStatus: true,
        stock: true,
        dcAvailableQty: true,
        supplierStock: true,
        supplierApprovalStatus: true,
        lastSupplierStockSyncAt: true,
        supplier: { select: { integrationKey: true, enabled: true } },
        media: {
          where: { kind: "IMAGE", syncStatus: "READY" },
          orderBy: { order: "asc" },
          take: 1,
          select: { url: true, thumbUrl: true },
        },
        priceListEntries: {
          where: activeRetailPriceEntryWhere(now),
          take: 1,
          select: { id: true },
        },
        familyMembership: {
          select: {
            familyId: true,
            family: { select: { code: true } },
          },
        },
      },
      orderBy: [{ name: "asc" }, { sku: "asc" }],
      take: 15,
    }),
  ]);

  return NextResponse.json({
    products: products.map((product) => {
      const publicationBlockers = storefrontPublicationBlockers({
        isActive: product.isActive,
        deletedAt: product.deletedAt,
        availableWebManual: product.availableWebManual,
        availableWebAuto: product.availableWebAuto,
        articleStatus: product.articleStatus,
        stock: product.stock,
        dcAvailableQty: product.dcAvailableQty,
        supplierStock: product.supplierStock,
        supplierApprovalStatus: product.supplierApprovalStatus,
        lastSupplierStockSyncAt: product.lastSupplierStockSyncAt,
        supplier: product.supplier,
        hasActiveRetailPrice: product.priceListEntries.length > 0,
        familyStorefrontEnabled: null,
      });
      const familyId = product.familyMembership?.familyId ?? null;
      return {
        id: product.id,
        sku: product.sku,
        name: product.name,
        colorPrimary: product.colorPrimary,
        colorSecondary: product.colorSecondary,
        imageUrl: resolveSupabaseStorageUrl(
          product.media[0]?.thumbUrl || product.media[0]?.url,
        ),
        familyCode: product.familyMembership?.family.code ?? null,
        alreadyInCurrentFamily: Boolean(
          familyId && familyId === sourceMembership?.familyId,
        ),
        canLink: !familyId,
        readinessReasons: productFamilyReadinessReasons({
          colorPrimary: product.colorPrimary,
          colorSecondary: product.colorSecondary,
          hasReadyImage: product.media.length > 0,
          publicationBlockers,
        }),
      };
    }),
  });
}
