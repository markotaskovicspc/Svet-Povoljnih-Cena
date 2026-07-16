import { NextResponse } from "next/server";
import { suggest } from "@/lib/api/search";
import { logOperationalError } from "@/lib/monitoring";
import {
  checkRateLimitForRequest,
  rateLimitJson,
  RATE_LIMITS,
} from "@/lib/security/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const limited = await checkRateLimitForRequest(req, "search:suggest", RATE_LIMITS.search);
  if (!limited.ok) {
    return rateLimitJson(limited);
  }
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q") ?? "";
  const limit = Number(searchParams.get("limit") ?? 8);
  try {
    const hits = await suggest(q, limit);
    return NextResponse.json({ ok: true, hits });
  } catch (err) {
    logOperationalError("api.search_suggest.failed", err, { q, limit });
    return NextResponse.json(
      { ok: false, error: "search_unavailable", hits: [] },
      { status: 503 },
    );
  }
}
