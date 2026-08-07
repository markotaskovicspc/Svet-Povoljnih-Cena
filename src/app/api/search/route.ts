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
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? "").trim().slice(0, 160);
  const requestedLimit = Number(searchParams.get("limit") ?? 48);
  const requestedOffset = Number(searchParams.get("offset") ?? 0);
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(Math.max(Math.trunc(requestedLimit), 1), 120)
    : 48;
  const offset = Number.isFinite(requestedOffset)
    ? Math.max(Math.trunc(requestedOffset), 0)
    : 0;
  try {
    const limited = await checkRateLimitForRequest(
      req,
      "search",
      RATE_LIMITS.search,
    );
    if (!limited.ok) {
      return rateLimitJson(limited);
    }

    const hits = await searchProducts(q, limit, offset);
    const response = NextResponse.json({ ok: true, hits });
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (err) {
    logOperationalError("api.search.failed", err, {
      queryLength: q.length,
      limit,
      offset,
    });
    return NextResponse.json(
      {
        ok: false,
        error: "search_unavailable",
        message: "Pretraga trenutno nije dostupna. Pokušajte ponovo.",
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
