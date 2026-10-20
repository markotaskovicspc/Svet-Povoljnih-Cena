import { summarize } from "@/lib/ananas/parcel-inspection";
import { NextResponse } from "next/server";
import { requireAdminAction } from "@/lib/admin";
import { envValue } from "@/lib/env";
import { checkRateLimit } from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 180;
const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex" };
const codes = ["KAP0000289404", "AAA0650159625"];

/** Temporary read-only provider inspection, expires even if cleanup deployment is delayed. */
export async function GET() {
  const actor = await requireAdminAction(["SUPER"]);
  if (Date.now() > Date.parse("2026-10-21T00:00:00Z")) return NextResponse.json({ error: "Inspection expired" }, { status: 410, headers });
  const limit = await checkRateLimit(`ananas-parcel-inspection:${actor.id}`, { limit: 5, windowMs: 3600000 });
  if (!limit.ok) return NextResponse.json({ error: "Too many inspections" }, { status: 429, headers });
  const clientId = envValue("ANANAS_CLIENT_ID"), clientSecret = envValue("ANANAS_CLIENT_SECRET");
  if (!clientId || !clientSecret) return NextResponse.json({ error: "Ananas not configured" }, { status: 503, headers });
  const deadline = AbortSignal.timeout(160000);
  const options = { cache: "no-store" as const, redirect: "error" as const };
  try {
    const auth = await fetch("https://api.ananas.rs/iam/api/v1/auth/token", {
      ...options, method: "POST", signal: AbortSignal.any([deadline, AbortSignal.timeout(25000)]),
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ grantType: "CLIENT_CREDENTIALS", clientId, clientSecret, scope: "public_api/full_access" }),
    });
    if (!auth.ok) return NextResponse.json({ authStatus: auth.status }, { status: 502, headers });
    const token = (await auth.json() as { access_token?: unknown }).access_token;
    if (typeof token !== "string") return NextResponse.json({ error: "No access token" }, { status: 502, headers });
    const queries = [
      ...codes.map(search => ({ search })),
      { statusGroup: "SG_COMPLETED", statuses: "RETURN_TO_SELLER" },
      { statusGroup: "SG_COMPLETED", statuses: "RETURNED_TO_SELLER" },
      { statusGroup: "SG_COMPLETED" },
    ];
    const results = [];
    for (const query of queries) {
      const params = new URLSearchParams({ ...query, page: "0", size: "25" } as Record<string, string>);
      const response = await fetch(`https://api.ananas.rs/order/api/v1/merchant-integration/outbound-orders/shipments?${params}`, {
        ...options, signal: AbortSignal.any([deadline, AbortSignal.timeout(25000)]),
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      });
      // Never return raw provider errors, tokens, customer data or signed URLs.
      results.push({ query, status: response.status, ...(response.ok ? summarize(await response.json()) : {}) });
    }
    return NextResponse.json({ inspectedAt: new Date().toISOString(), results }, { headers });
  } catch {
    return NextResponse.json({ error: "Provider inspection failed or timed out" }, { status: 502, headers });
  }
}
