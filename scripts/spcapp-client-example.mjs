/** Node 22+. Import from the SPCApp server; never bundle into browser code. */
export async function* readSpcappResource(resource, {
  baseUrl = process.env.SPCAPP_ERP_BASE_URL,
  apiKey = process.env.SPCAPP_ERP_API_KEY,
  from = '2025-05-01', to, limit = resource === 'sef-invoices' ? 10 : 100,
  granularity, basis, status, supplierPib,
} = {}) {
  if (!baseUrl || !apiKey || !to) throw new Error('Set server-side SPCAPP_ERP_BASE_URL / SPCAPP_ERP_API_KEY and an explicit to date.');
  const base = new URL(baseUrl);
  if (base.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(base.hostname)) throw new Error('HTTPS required.');
  let cursor;
  const seen = new Set();
  do {
    const url = new URL(`/api/partners/v1/spcapp/${encodeURIComponent(resource)}`, base);
    for (const [key, value] of Object.entries({ from, to, limit, granularity, basis, status, supplierPib, cursor })) if (value != null) url.searchParams.set(key, String(value));
    const deadline = Date.now() + 90_000;
    let data;
    for (let attempt = 0; attempt < 5; attempt++) {
      let response;
      try {
        response = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
          cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(Math.max(1, Math.min(30_000, deadline - Date.now()))) });
      } catch (error) { if (attempt === 4 || Date.now() >= deadline) throw error; }
      if (response?.ok) { data = await response.json(); break; }
      if (response && response.status !== 429 && response.status < 500) throw new Error(`ERP HTTP ${response.status}; requestId=${response.headers.get('x-request-id') || 'unknown'}`);
      if (attempt === 4) throw new Error('ERP export retry budget exhausted.');
      const retryHeader = Number(response?.headers.get('retry-after'));
      const waitMs = Number.isFinite(retryHeader) && retryHeader > 0 ? retryHeader * 1000 : 500 * 2 ** attempt + Math.random() * 250;
      if (Date.now() + waitMs >= deadline) throw new Error('ERP export deadline exceeded; resume this page later.');
      await new Promise(resolve => setTimeout(resolve, waitMs));
    }
    if (!data?.ok || data.resource !== resource || !Array.isArray(data.items) || typeof data.hasMore !== 'boolean' || (data.nextCursor !== null && typeof data.nextCursor !== 'string')) throw new Error('Invalid ERP response.');
    if (data.hasMore !== Boolean(data.nextCursor)) throw new Error('Inconsistent ERP pagination.');
    for (const item of data.items) {
      if (typeof item?.id !== 'string') throw new Error('ERP item lacks a stable ID.');
      yield item; // Consumer must UPSERT by (resource, item.id), not append.
    }
    cursor = data.nextCursor;
    if (cursor && seen.has(cursor)) throw new Error('Repeated ERP cursor; stop to avoid an infinite loop.');
    if (cursor) seen.add(cursor);
  } while (cursor);
}
