import { NextResponse } from "next/server";
import { getCartRecommendationsForSkus } from "@/lib/api/catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as
      | { skus?: unknown; limit?: unknown }
      | null;
    const skus = Array.isArray(body?.skus)
      ? body.skus.filter((sku): sku is string => typeof sku === "string")
      : [];
    const limit =
      typeof body?.limit === "number" && Number.isFinite(body.limit)
        ? Math.min(Math.max(Math.round(body.limit), 1), 12)
        : 6;
    const products = await getCartRecommendationsForSkus(skus, limit);
    return NextResponse.json({ products });
  } catch (error) {
    console.error("[cart/recommendations]", error);
    return NextResponse.json({ products: [] }, { status: 200 });
  }
}
