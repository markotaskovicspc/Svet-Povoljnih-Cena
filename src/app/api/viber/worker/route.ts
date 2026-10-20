import { NextResponse } from "next/server";
import { z } from "zod";
import { envValue } from "@/lib/env";
import { hasBearerSecret } from "@/lib/security/bearer";
import { db } from "@/lib/db";
import { isViberReady } from "@/lib/viber/config";
import { runDueCampaigns } from "@/lib/viber/campaign";
import { claimNthMessage, completeNthMessage } from "@/lib/viber/outbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("claim") }),
  z.object({ action: z.literal("campaigns") }),
  z.object({ action: z.literal("reports") }),
  z.object({ action: z.literal("delivery"), id: z.string().min(1).max(100), messageId: z.uuid(), status: z.enum(["DELIVERED", "SEEN", "FAILED"]) }),
  z.object({ action: z.literal("complete"), id: z.string().min(1).max(100), outcome: z.enum(["accepted", "failed", "unknown"]), messageId: z.uuid().optional() }),
]);

export async function POST(req: Request) {
  const secret = envValue("NTH_WORKER_TOKEN");
  if (!secret || secret.length < 32 || !hasBearerSecret(req, secret)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const input = schema.safeParse(await req.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  if (input.data.action === "reports") {
    const now = new Date();
    const jobs = await db.backgroundJob.findMany({ where: { kind: "NTH_VIBER_OUTBOUND", status: { in: ["VIBER_SENT", "VIBER_DELIVERED"] }, createdAt: { gte: new Date(now.getTime() - 7*86400_000) }, availableAt: { lte: now }, lastError: { startsWith: "NTH:" } }, orderBy: { availableAt: "asc" }, take: 20, select: { id: true, lastError: true } });
    await db.backgroundJob.updateMany({ where: { id: { in: jobs.map(j => j.id) } }, data: { availableAt: new Date(now.getTime()+60_000) } });
    return NextResponse.json({ jobs: jobs.map(j => ({ id: j.id, messageId: j.lastError!.slice(4) })) }, { headers: { "Cache-Control": "no-store" } });
  }
  if (input.data.action === "delivery") {
    const { id, messageId, status } = input.data;
    await db.backgroundJob.updateMany({ where: { id, kind: "NTH_VIBER_OUTBOUND", lastError: `NTH:${messageId}`, status: { in: status === "FAILED" ? ["VIBER_SENT"] : ["VIBER_SENT", "VIBER_DELIVERED"] } }, data: { status: `VIBER_${status}` } });
    return NextResponse.json({ ok: true });
  }
  if (input.data.action === "campaigns") {
    if (envValue("VIBER_SCHEDULED_CAMPAIGNS_ENABLED") === "true") await runDueCampaigns();
    return NextResponse.json({ ok: true });
  }
  if (input.data.action === "claim" && !isViberReady()) return NextResponse.json({ job: null }, { headers: { "Cache-Control": "no-store" } });
  if (input.data.action === "claim") return NextResponse.json({ job: await claimNthMessage() }, { headers: { "Cache-Control": "no-store" } });
  await completeNthMessage(input.data.id, input.data.outcome, input.data.messageId);
  return NextResponse.json({ ok: true });
}
