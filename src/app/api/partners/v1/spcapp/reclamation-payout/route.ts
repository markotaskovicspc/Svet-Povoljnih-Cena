import 'server-only';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db } from '@/lib/db';
import { authenticatePartner, partnerRateLimitHeaders } from '@/lib/partners/auth';
import { confirmReclamationPayout } from '@/lib/admin/reclamation-refund.server';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const input = z.object({
  id: z.string().min(1).max(100),
  paidAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  statementNumber: z.string().trim().min(1).max(50),
  cents: z.number().int().positive().max(1_000_000_000).optional(),
}).strict();

/**
 * SPC Analytics (Marko, 12.11.2026): kad je uplata kupcu nađena na izvodu, ERP evidentira isplatu kao dugme
 * „Novac je vraćen kupcu · reši reklamaciju“ (datum uplate, broj izvoda, potvrda) i reklamacija postaje Rešeno.
 * Isti uslovi kao u ERP-u: fiskalna refundacija mora biti izdata; Ananas reklamacije se ne diraju; kupcu se ne šalje mejl.
 */
export async function POST(request: Request) {
  const requestId = randomUUID();
  let headers: Record<string, string> = { 'Cache-Control': 'private, no-store', 'Vary': 'Authorization', 'X-Request-Id': requestId, 'X-Content-Type-Options': 'nosniff' };
  const auth = await authenticatePartner(request, 'spcapp:reclamation-payout');
  if (auth.rateLimit) headers = { ...headers, ...Object.fromEntries(new Headers(partnerRateLimitHeaders(auth.rateLimit))) };
  if (!auth.ok) return Response.json({ ok: false, error: auth.error, requestId }, { status: auth.status, headers });
  const raw = await request.text();
  if (raw.length > 2000) return Response.json({ ok: false, error: 'Request too large.', requestId }, { status: 413, headers });
  let body: unknown; try { body = JSON.parse(raw); } catch { return Response.json({ ok: false, error: 'Invalid JSON.', requestId }, { status: 400, headers }); }
  const parsed = input.safeParse(body);
  if (!parsed.success) return Response.json({ ok: false, error: 'Expected id, paidAt (YYYY-MM-DD) and statementNumber.', requestId }, { status: 400, headers });
  const q = parsed.data;
  const claim = await db.reclamation.findUnique({ where: { id: q.id }, select: { id: true, status: true, order: { select: { channel: true } } } });
  if (!claim) return Response.json({ ok: false, error: 'Reklamacija nije pronađena u ERP-u.', requestId }, { status: 404, headers });
  const audit = (result: string, error?: string) => db.auditLog.create({ data: { action: 'partner.spcapp.reclamation.payout', entity: 'Reclamation', entityId: claim.id, diff: { clientId: auth.client.id, result, paidAt: q.paidAt, statementNumber: q.statementNumber, ...(q.cents ? { cents: q.cents } : {}), ...(error ? { error } : {}) } } });
  if (claim.order.channel === 'ANANAS') return Response.json({ ok: false, result: 'skipped', error: 'Ananas reklamacija se ne rešava iz SPC Analytics.', requestId }, { status: 422, headers });
  if (claim.status === 'RESENO') return Response.json({ ok: true, result: 'already', requestId }, { headers });
  try {
    await confirmReclamationPayout({
      id: claim.id, paidAt: q.paidAt, reference: `Izvod br. ${q.statementNumber}`, actorId: null, confirmed: true,
      note: `Evidentirao SPC Analytics sa izvoda${q.cents ? ` (uplata ${(q.cents / 100).toFixed(2)} RSD)` : ''}`,
    });
    await audit('resolved');
    return Response.json({ ok: true, result: 'resolved', requestId }, { headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Evidentiranje isplate nije uspelo.';
    await audit('refused', message);
    return Response.json({ ok: false, result: 'refused', error: message, requestId }, { status: 409, headers });
  }
}
