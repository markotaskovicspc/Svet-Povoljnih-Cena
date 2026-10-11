import { NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/security/bearer";
import { queueSefSync, refreshSefInvoice } from "@/lib/sef/documents.server";
import { ensureSefInventoryPosted } from "@/lib/sef/inventory.server";
import { requireSefConfig } from "@/lib/sef/config";
import { db } from "@/lib/db";
import { refreshDispatchNoteSef } from "@/lib/admin/dispatch-note.server";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;
export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request, process.env.SEF_CRON_SECRET)) return NextResponse.json({ ok: false }, { status: 401 });
  let queued = 0, refreshed = 0, failed = 0;
  try {
    const config = requireSefConfig();
    if (process.env.SEF_INBOX_SYNC_ENABLED === "true") {
      const today = new Date().toISOString().slice(0, 10), yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      queued = await queueSefSync(yesterday, today, null);
    }
    const docs = await db.sefDocument.findMany({ where: { direction: "OUT", environment: config.environment, remoteId: { not: null }, OR: [{ status: { in: ["SUBMITTED", "Sent", "Seen"] } }, { sentAt: { not: null }, inventoryPostedAt: null }] }, take: 6, orderBy: { updatedAt: "asc" }, select: { id: true } });
    for (const doc of docs) { try { await ensureSefInventoryPosted(doc.id); await refreshSefInvoice(doc.id); refreshed++; } catch { failed++; } }
  } catch { failed++; }
  const notes = await db.dispatchNote.findMany({ where: { sefStatus: { in: ["SUBMITTED", "UNKNOWN", "SENDING"] }, sefRequestId: { not: null } }, select: { id: true }, take: 3, orderBy: { updatedAt: "asc" } });
  for (const note of notes) { try { await refreshDispatchNoteSef(note.id); refreshed++; } catch { failed++; } }
  return NextResponse.json({ ok: failed === 0, queued, refreshed, failed });
}
