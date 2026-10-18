import { requireAdminAction } from '@/lib/admin';
import { db } from '@/lib/db';
import { BRAND } from '@/lib/brand';
import { PageHeader } from '@/components/admin/page-header';
import { AdminActionForm } from '@/components/admin/action-form';
import { SubmitButton } from '@/components/admin/submit-button';
import { NewKeyForm } from './new-key-form';
import { revokeSpcappKey } from './actions';
export const dynamic = 'force-dynamic';
export const metadata = { title: 'SPCApp API', robots: { index: false, follow: false } };
export default async function SpcappPage() {
  await requireAdminAction(['SUPER']);
  const clients = await db.partnerApiClient.findMany({ where: { scopes: { has: 'spcapp:read' } }, orderBy: { createdAt: 'desc' }, select: { id: true, name: true, enabled: true, createdAt: true, lastUsedAt: true, rateLimit: true } });
  return <><PageHeader title="SPCApp API" description="Povezivanje SPC Cash Flow aplikacije sa ERP podacima." />
    <main className="space-y-6 p-4 md:p-8">
      <section className="space-y-3 rounded-xl border bg-surface p-5"><h2 className="text-lg font-semibold">Povezivanje</h2>
        <p className="text-sm">U serverske tajne SPCApp-a upišite:</p><pre className="overflow-x-auto rounded-lg bg-muted p-3 text-sm">{`SPCAPP_ERP_BASE_URL=${BRAND.url}\nSPCAPP_ERP_API_KEY=<novi ključ>`}</pre>
        <p className="text-sm">Početni endpoint: <code>/api/partners/v1/spcapp</code>. Autentikacija: <code>Authorization: Bearer &lt;ključ&gt;</code>.</p>
        <p className="text-sm">Dokumentacija je u projektu: <code>docs/SPCAPP-API.md</code>. Preuzimajte sve stranice pomoću nextCursor i ažurirajte zapise po ID-u. Naknadne fakture zahtevaju ponovno čitanje istorijskog COGS-a.</p>
      </section>
      <NewKeyForm />
      <section className="space-y-3"><h2 className="text-lg font-semibold">Ključevi ({clients.length})</h2>{clients.map(client => <article key={client.id} className="flex flex-wrap items-center justify-between gap-4 rounded-xl border bg-surface p-4"><div><h3 className="font-medium">{client.name}</h3><p className="text-sm">{client.enabled ? 'Aktivan' : 'Opozvan'} · {client.rateLimit} zahteva/min · {client.lastUsedAt ? `Poslednji poziv: ${client.lastUsedAt.toLocaleString('sr-Latn-RS', { timeZone: 'Europe/Belgrade' })}` : 'Još nije korišćen'}</p></div>
        {client.enabled && <AdminActionForm action={revokeSpcappKey} refreshOnSuccess><input type="hidden" name="id" value={client.id} /><SubmitButton variant="outline" confirm="Opozvati pristup SPCApp-a ovim ključem?">Opozovi ključ</SubmitButton></AdminActionForm>}
      </article>)}{!clients.length && <p className="text-sm text-ink-500">Nema napravljenih SPCApp ključeva.</p>}</section>
    </main></>;
}
