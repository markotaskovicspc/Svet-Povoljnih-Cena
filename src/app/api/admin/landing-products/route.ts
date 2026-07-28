import { NextResponse } from "next/server";
import { requireAdminAction } from "@/lib/admin";
import { db } from "@/lib/db";
import { resolveSupabaseStorageUrl } from "@/lib/supabase/storage";
import { webStorefrontProductWhere } from "@/lib/web-storefront-availability";

export async function GET(request: Request) {
  await requireAdminAction(["CONTENT"]);
  const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (query.length < 2) return NextResponse.json({ products: [] });
  const products = await db.product.findMany({
    where: {
      ...webStorefrontProductWhere(),
      deletedAt: null,
      OR: [
        { sku: { contains: query, mode: "insensitive" } },
        { name: { contains: query, mode: "insensitive" } },
        { slug: { contains: query, mode: "insensitive" } },
      ],
    },
    select: {
      sku: true,
      name: true,
      slug: true,
      media: {
        where: { kind: "IMAGE", syncStatus: "READY" },
        select: { url: true, thumbUrl: true },
        orderBy: { order: "asc" },
        take: 1,
      },
    },
    orderBy: [{ name: "asc" }, { sku: "asc" }],
    take: 15,
  });
  return NextResponse.json({
    products: products.map((product) => ({
      sku: product.sku,
      name: product.name,
      slug: product.slug,
      imageUrl: resolveSupabaseStorageUrl(product.media[0]?.thumbUrl || product.media[0]?.url),
    })),
  });
}
