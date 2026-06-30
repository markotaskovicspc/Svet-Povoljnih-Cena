import { NextResponse } from "next/server";
import { suggest } from "@/lib/api/search";
import {
  checkRateLimitForRequest,
  rateLimitJson,
  RATE_LIMITS,
} from "@/lib/security/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const limited = checkRateLimitForRequest(req, "search:suggest", RATE_LIMITS.search);
  if (!limited.ok) {
    return rateLimitJson(limited);
  }
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q") ?? "";
  const limit = Number(searchParams.get("limit") ?? 8);
  try {
    const hits = await suggest(q, limit);
    return NextResponse.json({ hits });
  } catch (err) {
    console.error("[search/suggest]", err);
    return NextResponse.json({ hits: [] }, { status: 200 });
  }
}
