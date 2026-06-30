import { NextResponse } from "next/server";
import { searchProducts } from "@/lib/api/search";
import {
  checkRateLimitForRequest,
  rateLimitJson,
  RATE_LIMITS,
} from "@/lib/security/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const limited = checkRateLimitForRequest(req, "search", RATE_LIMITS.search);
  if (!limited.ok) {
    return rateLimitJson(limited);
  }
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q") ?? "";
  const limit = Number(searchParams.get("limit") ?? 48);
  const offset = Number(searchParams.get("offset") ?? 0);
  try {
    const hits = await searchProducts(q, limit, offset);
    return NextResponse.json({ ok: true, hits });
  } catch (err) {
    console.error("[search]", err);
    return NextResponse.json({ ok: true, hits: [] }, { status: 200 });
  }
}
