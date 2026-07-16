import { NextResponse } from "next/server";
import { searchProducts } from "@/lib/api/search";
import { logOperationalError } from "@/lib/monitoring";
import {
  checkRateLimitForRequest,
  rateLimitJson,
  RATE_LIMITS,
} from "@/lib/security/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const limited = await checkRateLimitForRequest(req, "search", RATE_LIMITS.search);
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
    logOperationalError("api.search.failed", err, { q, limit, offset });
    return NextResponse.json(
      { ok: false, error: "search_unavailable", hits: [] },
      { status: 503 },
    );
  }
}
