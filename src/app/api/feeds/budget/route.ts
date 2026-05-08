import { NextResponse } from "next/server";
import { z } from "zod";
import { listBudgets, upsertBudget, type AdChannelKey } from "@/lib/feeds";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Phase 4G — Per-channel ad budget management.
 *
 *   GET  /api/feeds/budget                        → list current budgets
 *   POST /api/feeds/budget                        → upsert one channel
 *     Authorization: Bearer $ADMIN_API_SECRET
 *     { "channel": "GOOGLE_MERCHANT" | "META" | "TIKTOK",
 *       "enabled": boolean,
 *       "budgetRsd": number | null }
 *
 * v1 stores the budget. v1.1 will push to the Google Ads / Meta
 * Marketing APIs from a worker that reads the same `AdFlag` rows.
 */

const channelEnum = z.enum(["GOOGLE_MERCHANT", "META", "TIKTOK"]);
const bodySchema = z.object({
  channel: channelEnum,
  enabled: z.boolean(),
  budgetRsd: z.number().min(0).max(100_000_000).nullable(),
});

function isAuthorized(req: Request): boolean {
  const expected = process.env.ADMIN_API_SECRET ?? process.env.CRON_SECRET;
  if (!expected) return false;
  const header = req.headers.get("authorization");
  return header === `Bearer ${expected}`;
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const budgets = await listBudgets();
  return NextResponse.json({ ok: true, budgets });
}

export async function POST(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "invalid_payload", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const channel: AdChannelKey = parsed.data.channel;
  const budget = await upsertBudget({
    channel,
    enabled: parsed.data.enabled,
    budgetRsd: parsed.data.budgetRsd,
  });
  return NextResponse.json({ ok: true, budget });
}
