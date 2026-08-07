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
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? "").trim().slice(0, 160);
  const requestedLimit = Number(searchParams.get("limit") ?? 8);
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(Math.max(Math.trunc(requestedLimit), 1), 12)
    : 8;
  try {
    const limited = await checkRateLimitForRequest(
      req,
      "search:suggest",
      RATE_LIMITS.search,
    );
    if (!limited.ok) {
      return rateLimitJson(limited);
    }

    const result = await suggest(q, limit);
    const response = NextResponse.json({ ok: true, ...result });
    response.headers.set("Cache-Control", "private, no-store");
    if (result.degraded) {
      response.headers.set("X-Search-Degraded", "navigation");
    }
    return response;
  } catch (err) {
    logOperationalError("api.search_suggest.failed", err, {
      queryLength: q.length,
      limit,
    });
    return NextResponse.json(
      {
        ok: false,
        error: "search_unavailable",
        message: "Predlozi trenutno nisu dostupni. Pokušajte ponovo.",
        hits: [],
      },
      {
        status: 503,
        headers: {
          "Cache-Control": "private, no-store",
          "Retry-After": "2",
        },
      },
    );
  }
}
