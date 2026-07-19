import { NextResponse } from "next/server";
import { z } from "zod";
import { getCartRecommendationsForSkus } from "@/lib/api/catalog";
import { logOperationalError } from "@/lib/monitoring";
import {
  checkRateLimitForRequest,
  rateLimitJson,
  RATE_LIMITS,
} from "@/lib/security/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  skus: z.array(z.string().trim().min(1).max(64)).max(50).default([]),
  limit: z.number().int().min(1).max(12).optional(),
});

export async function POST(request: Request) {
  try {
    const limited = await checkRateLimitForRequest(
      request,
      "cart:recommendations",
      RATE_LIMITS.search,
    );
    if (!limited.ok) return rateLimitJson(limited);

    const parsed = bodySchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: "invalid_request", products: [] },
        { status: 400 },
      );
    }
    const skus = Array.from(new Set(parsed.data.skus));
    const products = await getCartRecommendationsForSkus(
      skus,
      parsed.data.limit ?? 6,
    );
    return NextResponse.json({ ok: true, products });
  } catch (error) {
    logOperationalError("api.cart_recommendations.failed", error);
    return NextResponse.json(
      { ok: false, error: "recommendations_unavailable", products: [] },
      { status: 503 },
    );
  }
}
