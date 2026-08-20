import { NextResponse } from "next/server";
import { getProductBySlug } from "@/lib/api/catalog";
import { getProductAvailability } from "@/lib/product-availability";
import { z } from "zod";
import { db } from "@/lib/db";
import { resolveRabaluxAvailability } from "@/lib/rabalux/availability";
import { isRabaluxSupplierOperational } from "@/lib/rabalux/config";
import { isProductAvailableOnWeb } from "@/lib/web-storefront-availability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const availabilityRequestSchema = z.object({
  quantity: z.number().int().min(1).max(999),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const parsed = availabilityRequestSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
  const { slug } = await params;
  const product = await db.product.findUnique({
    where: { slug },
    select: {
      stock: true,
      dcAvailableQty: true,
      deletedAt: true,
      isActive: true,
      availableWebManual: true,
      availableWebAuto: true,
      articleStatus: true,
      supplierStock: true,
      supplierReservedStock: true,
      supplierApprovalStatus: true,
      lastSupplierStockSyncAt: true,
      supplier: {
        select: { integrationKey: true, enabled: true },
      },
    },
  });
  if (!product || !isProductAvailableOnWeb(product)) {
    return NextResponse.json({
      available: false,
      message: "Artikal trenutno nije dostupan za online kupovinu.",
    });
  }
  const sellable =
    product.supplier?.integrationKey === "RABALUX"
      ? resolveRabaluxAvailability({
          warehouseStock: product.dcAvailableQty,
          supplierStock: product.supplierStock,
          supplierReservedStock: product.supplierReservedStock,
          lastSupplierStockSyncAt: product.lastSupplierStockSyncAt,
          supplierOperational: isRabaluxSupplierOperational(product.supplier),
          supplierApproved: product.supplierApprovalStatus === "APPROVED",
        }).sellableStock
      : product.stock;

  const available = sellable >= parsed.data.quantity;
  return NextResponse.json({
    available,
    message: available
      ? null
      : "Tražena količina trenutno nije dostupna. Osvežite korpu i pokušajte ponovo.",
    checkedAt: new Date().toISOString(),
  });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const product = await getProductBySlug(slug);

  if (!product) {
    return NextResponse.json(
      { error: "not_found" },
      {
        status: 404,
        headers: { "Cache-Control": "public, max-age=0, s-maxage=15" },
      },
    );
  }

  return NextResponse.json(
    {
      availability: getProductAvailability(product),
      checkedAt: new Date().toISOString(),
    },
    {
      headers: {
        // Availability is public and contains no exact supplier quantity.
        // The short edge TTL absorbs bursts while checkout remains authoritative.
        "Cache-Control":
          "public, max-age=0, s-maxage=15, stale-while-revalidate=15",
      },
    },
  );
}
