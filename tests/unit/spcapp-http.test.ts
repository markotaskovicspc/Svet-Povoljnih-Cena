import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), export: vi.fn(), audit: vi.fn(), attachment: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: { auditLog: { create: mocks.audit } } }));
vi.mock('@/lib/partners/auth', () => ({ authenticatePartner: mocks.auth, partnerRateLimitHeaders: () => ({ 'Retry-After': '30' }) }));
vi.mock('@/lib/partners/spcapp/export.server', () => ({ exportResource: mocks.export }));
vi.mock('@/lib/partners/spcapp/logistics.server', () => ({ downloadSefAttachment: mocks.attachment }));
import { spcappGet } from '@/lib/partners/spcapp/http.server';
const req = (query = '') => new Request(`https://erp.test/api/partners/v1/spcapp/orders?${query}`);
beforeEach(() => {
  vi.clearAllMocks(); mocks.auth.mockResolvedValue({ ok: true, client: { id: 'client', keyHash: 'secret' } });
  mocks.export.mockResolvedValue([]); mocks.audit.mockResolvedValue({});
});
it.each([401,403,429])('returns %i before accessing export data and makes every response private', async status => {
  mocks.auth.mockResolvedValue({ ok: false, status, error: 'denied', rateLimit: status === 429 ? {} : undefined });
  const response = await spcappGet(req(), 'orders');
  expect(response.status).toBe(status); expect(response.headers.get('cache-control')).toContain('no-store');
  if(status === 429)expect(response.headers.get('retry-after')).toBe('30');
  expect(mocks.export).not.toHaveBeenCalled();
});
it('returns a manifest and enforces the new scope', async () => {
  const r = await spcappGet(req()); const data = await r.json();
  expect(mocks.auth).toHaveBeenCalledWith(expect.any(Request), 'spcapp:read');
  expect(data.resources).toContainEqual(expect.objectContaining({ name: 'ananas-fiscal-documents' }));
  expect(data.resources).toContainEqual(expect.objectContaining({ name: 'goods-receipts', path: '/api/partners/v1/spcapp/goods-receipts' }));
  expect(data.sync).toMatchObject({ updatedSinceSupported: false, mode: 'FULL_RESCAN_UPSERT' });
});
it('serves goods receipts through the existing private, scoped and audited export', async () => {
  mocks.export.mockResolvedValue([{ id: 'receipt', number: 'PR-1' }]);
  const response = await spcappGet(new Request('https://erp.test/api/partners/v1/spcapp/goods-receipts?from=2026-10-01&to=2026-10-27'), 'goods-receipts');
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toContain('private, no-store');
  expect(mocks.auth).toHaveBeenCalledWith(expect.any(Request), 'spcapp:read');
  expect(mocks.export.mock.lastCall![0].resource).toBe('goods-receipts');
  expect(await response.json()).toMatchObject({ resource: 'goods-receipts', count: 1, items: [{ id: 'receipt', number: 'PR-1' }] });
  expect(mocks.audit.mock.lastCall![0].data.diff).toEqual({ resource: 'goods-receipts', rows: 1, from: '2026-10-01', to: '2026-10-27' });
});
it('pages without dropping rows, signs cursors and never includes lookahead rows', async () => {
  mocks.export.mockResolvedValue([{ id: 'a', amount: '12.34' }, { id: 'b' }, { id: 'c' }]);
  const first = await (await spcappGet(req('limit=2'), 'orders')).json();
  expect(first.items.map((i: {id:string}) => i.id)).toEqual(['a','b']); expect(first.hasMore).toBe(true);
  mocks.export.mockResolvedValue([{ id: 'c' }]);
  const second = await (await spcappGet(req(`limit=2&cursor=${first.nextCursor}`), 'orders')).json();
  expect(mocks.export.mock.lastCall![0].after).toBe('b'); expect(second).toMatchObject({ hasMore: false, nextCursor: null });
  expect(mocks.audit.mock.calls[0][0].data.diff).not.toHaveProperty('items');
});
it('rejects invalid queries, unknown resources, and oversized SEF pages', async () => {
  expect((await spcappGet(req('limit=0'), 'orders')).status).toBe(400);
  expect((await spcappGet(req(), 'unknown')).status).toBe(404);
  expect((await spcappGet(req('limit=11'), 'sef-invoices')).status).toBe(400);
  expect(mocks.export).not.toHaveBeenCalled();
});
it('does not reveal internal exception details', async () => {
  const log=vi.spyOn(console,'error').mockImplementation(()=>{});
  mocks.export.mockRejectedValue(new Error('postgres://private-password@host'));
  const r=await spcappGet(req(),'orders'); expect(r.status).toBe(500);
  expect(await r.text()).not.toContain('private-password'); log.mockRestore();
});
it('downloads attachments through the same bearer protection', async () => {
  mocks.attachment.mockResolvedValue({ bytes:Buffer.from('pdf'),filename:'račun.pdf',mime:'application/pdf' });
  const r=await spcappGet(req(), 'sef-attachment');
  expect(await r.text()).toBe('pdf'); expect(r.headers.get('content-disposition')).toContain('attachment;');
  expect(r.headers.get('content-type')).toBe('application/octet-stream');
});
