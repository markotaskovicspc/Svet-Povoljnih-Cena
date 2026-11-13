import 'server-only';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db } from '@/lib/db';
import { authenticatePartner, partnerRateLimitHeaders } from '@/lib/partners/auth';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const input = z.object({
  items: z.array(z.object({
    id: z.string().min(1).max(100),
    label: z.string().trim().min(1).max(80),
    note: z.string().trim().max(240).optional(),
  }).strict()).max(200),
}).strict();

/**
 * SPC Analytics (Marko, 13.11.2026): stanje reklamacije iz „Reklamacije i povrati“ (npr. Čeka robu, Spremno za plaćanje,
 * Uplaćeno) upisuje se u kolonu „SPC Analytics“ dnevnika reklamacija. Samo prikaz; odluka, status i novac se ne menjaju.
 */
export async function POST(request: Request) {
  const requestId = randomUUID();
  let headers: Record<string, string> = { 'Cache-Control': 'private, no-store', 'Vary': 'Authorization', 'X-Request-Id': requestId, 'X-Content-Type-Options': 'nosniff' };
  const auth = await authenticatePartner(request, 'spcapp:reclamation-payout');
  if (auth.rateLimit) headers = { ...headers, ...Object.fromEntries(new Headers(partnerRateLimitHeaders(auth.rateLimit))) };
  if (!auth.ok) return Response.json({ ok: false, error: auth.error, requestId }, { status: auth.status, headers });
  const raw = await request.text();
  if (raw.length > 120_000) return Response.json({ ok: false, error: 'Request too large.', requestId }, { status: 413, headers });
  let body: unknown; try { body = JSON.parse(raw); } catch { return Response.json({ ok: false, error: 'Invalid JSON.', requestId }, { status: 400, headers }); }
  const parsed = input.safeParse(body);
  if (!parsed.success) return Response.json({ ok: false, error: 'Expected items: [{ id, label, note? }].', requestId }, { status: 400, headers });
  const at = new Date();
  let updated = 0;
  for (const item of parsed.data.items) {
    const result = await db.reclamation.updateMany({
      where: { id: item.id },
      data: { analyticsStatus: item.label, analyticsStatusNote: item.note || null, analyticsStatusAt: at },
    });
    updated += result.count;
  }
  await db.auditLog.create({ data: { action: 'partner.spcapp.reclamation.analytics_status', entity: 'Reclamation', diff: { clientId: auth.client.id, items: parsed.data.items.length, updated } } });
  return Response.json({ ok: true, updated, requestId }, { headers });
}
