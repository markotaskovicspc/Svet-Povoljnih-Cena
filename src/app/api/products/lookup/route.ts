import { NextResponse } from "next/server";
import { z } from "zod";
import { getProductBySku } from "@/lib/api/catalog";
import { getMediaVariantUrl } from "@/lib/media";
import { resolveProductPriceQuote } from "@/lib/pricing";
import type { Product, WishlistProductSnapshot } from "@/types";
import {
  checkRateLimitForRequest,
  rateLimitJson,
  RATE_LIMITS,
} from "@/lib/security/rate-limit";
import { getCurrentUser } from "@/lib/auth/session";
import { hasStorefrontIncomingStock } from "@/lib/storefront-incoming";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  skus: z.array(z.string().min(1).max(64)).min(1).max(50),
});

export async function POST(req: Request) {
  const limited = await checkRateLimitForRequest(
    req,
    "products:lookup",
    RATE_LIMITS.search,
  );
  if (!limited.ok) return rateLimitJson(limited);

  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }

  const skus = Array.from(new Set(parsed.data.skus.map((sku) => sku.trim())));
  const [catalogProducts, currentUser] = await Promise.all([
    Promise.all(skus.map((sku) => getProductBySku(sku))),
    getCurrentUser(),
  ]);
  const products: Product[] = catalogProducts
    .filter((product): product is Product => Boolean(product))
    .map((product) => ({
      ...product,
      loyaltyEligible: currentUser?.userType === "customer",
    }));
  const items: WishlistProductSnapshot[] = products.map((product) => {
    const quote = resolveProductPriceQuote(product, {
      loggedIn: product.loyaltyEligible,
    });
    return {
      sku: product.sku,
      slug: product.slug,
      name: product.name,
      fullPrice: quote.full,
      effectivePrice: quote.payable.effective,
      actionPrice: quote.actionOffer?.effective,
      loyaltyPrice: quote.loyaltyOffer?.effective,
      discountPct: product.discountPct,
      inStock: product.stock > 0,
      incoming: hasStorefrontIncomingStock(product),
      thumbnailUrl: getMediaVariantUrl(product.media.images[0], "thumb") || null,
    };
  });

  return NextResponse.json({ items, products });
}
