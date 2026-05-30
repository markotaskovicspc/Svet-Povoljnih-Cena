import { NextResponse } from "next/server";
import { z } from "zod";
import { getProductBySku } from "@/lib/api/catalog";
import { effectiveUnitPrice } from "@/lib/pricing";
import type { WishlistProductSnapshot } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  skus: z.array(z.string().min(1).max(64)).min(1).max(50),
});

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }

  const skus = Array.from(new Set(parsed.data.skus.map((sku) => sku.trim())));
  const products = await Promise.all(skus.map((sku) => getProductBySku(sku)));
  const items: WishlistProductSnapshot[] = products.flatMap((product) => {
    if (!product) return [];
    const price = effectiveUnitPrice(product);
    return {
      sku: product.sku,
      slug: product.slug,
      name: product.name,
      fullPrice: price.full,
      effectivePrice: price.effective,
      discountPct: product.discountPct,
      inStock: product.stock > 0,
      incoming: product.incomingStock > 0,
      thumbnailUrl: product.media.images[0]?.url ?? null,
    };
  });

  return NextResponse.json({ items });
}
