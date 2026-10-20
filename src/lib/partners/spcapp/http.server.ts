import 'server-only';
import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticatePartner, partnerRateLimitHeaders } from '@/lib/partners/auth';
import { API_VERSION, RESOURCES, ExportInputError, jsonSafe, parseExportQuery } from './contract';
import { exportResource } from './export.server';
import { downloadSefAttachment } from './logistics.server';

const privateHeaders = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Authorization', 'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex, nofollow' };
export async function spcappGet(request: Request, resource?: string) {
  const requestId = randomUUID();
  let headers: Record<string, string> = { ...privateHeaders, 'X-Request-Id': requestId };
  try {
    const auth = await authenticatePartner(request, 'spcapp:read');
    if (auth.rateLimit) headers = { ...headers, ...Object.fromEntries(new Headers(partnerRateLimitHeaders(auth.rateLimit))) };
    if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error, requestId }, { status: auth.status, headers });
    if (!resource) return NextResponse.json({ ok: true, apiVersion: API_VERSION, scope: 'spcapp:read', timezone: 'Europe/Belgrade', currency: 'RSD',
      resources: Object.entries(RESOURCES).map(([name, description]) => ({ name, path: `/api/partners/v1/spcapp/${name}`, description })),
      attachmentPath: '/api/partners/v1/spcapp/sef-attachment?documentId=ID&index=0',
      sync: { mode: 'FULL_RESCAN_UPSERT', defaultFrom: '2025-05-01', defaultLimit: 100, maxLimit: 200, sefMaxLimit: 10,
        isolation: 'LIVE_PAGES_NOT_TRANSACTIONAL_SNAPSHOT', updatedSinceSupported: false,
        instructions: 'Keep from/to fixed across pages. Upsert by (resource,id). Only complete successful full scans can reconcile missing IDs. Re-read historical fiscal data after invoice changes; no reliable incremental feed exists yet.' },
      limitations: ['No guarantee of complete history since 2025-05-01.', 'Ananas customer identity and parcel dimensions not captured.', 'SEF specification lines and import VAT require further classification.', 'No names, addresses, phone numbers, customer email or raw provider payloads in JSON exports.'],
    }, { headers });
    const url = new URL(request.url);
    if (resource === 'sef-attachment') {
      const file = await downloadSefAttachment(url);
      if (!file) return NextResponse.json({ ok: false, error: 'Attachment not found.', requestId }, { status: 404, headers });
      await db.auditLog.create({ data: { action: 'partner.spcapp.attachment.read', entity: 'PartnerApiClient', entityId: auth.client.id, diff: { documentId: url.searchParams.get('documentId'), index: url.searchParams.get('index') } } });
      return new Response(new Uint8Array(file.bytes), { headers: { ...headers, 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}` } });
    }
    if (!Object.prototype.hasOwnProperty.call(RESOURCES, resource)) return NextResponse.json({ ok: false, error: 'Unknown resource.', requestId }, { status: 404, headers });
    // SEF XML can contain large embedded attachments; keep each page bounded.
    if (resource === 'sef-invoices' && !url.searchParams.has('limit')) url.searchParams.set('limit', '10');
    const q = parseExportQuery(resource, url, auth.client.keyHash);
    if (resource === 'sef-invoices' && q.limit > 10) throw new ExportInputError('SEF limit must be 1..10.');
    const result = await exportResource(q);
    const hasMore = result.length > q.limit, items = result.slice(0, q.limit);
    await db.auditLog.create({ data: { action: 'partner.spcapp.read', entity: 'PartnerApiClient', entityId: auth.client.id,
      diff: { resource, rows: items.length, from: q.history === 'all' ? null : q.period.fromInput, to: q.history === 'all' ? null : q.period.toInput, ...(q.history ? {history:q.history} : {}) } } });
    return NextResponse.json(jsonSafe({ ok: true, apiVersion: API_VERSION, resource, generatedAt: new Date().toISOString(), requestId,
      from: q.history === 'all' ? null : q.period.fromInput, to: q.history === 'all' ? null : q.period.toInput, ...(q.history ? {history:q.history} : {}), timezone: 'Europe/Belgrade', currency: 'RSD', count: items.length, hasMore,
      nextCursor: hasMore ? q.nextCursor(items.at(-1)!.id) : null, items,
    }), { headers });
  } catch (error) {
    if (error instanceof ExportInputError) return NextResponse.json({ ok: false, error: error.message, requestId }, { status: 400, headers });
    console.error('[spcapp-export]', { requestId, resource, errorType: error instanceof Error ? error.name : 'unknown' });
    return NextResponse.json({ ok: false, error: 'Export failed. Retry with backoff; contact support with requestId if repeated.', requestId }, { status: 500, headers });
  }
}
