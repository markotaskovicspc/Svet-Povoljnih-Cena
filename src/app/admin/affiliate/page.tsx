import Link from "next/link";
import { db } from "@/lib/db";
import { requireAdminAction } from "@/lib/admin";
import { BRAND } from "@/lib/brand";
import { PageHeader } from "@/components/admin/page-header";
import { AdminActionForm } from "@/components/admin/action-form";
import { SubmitButton } from "@/components/admin/submit-button";
import { Field } from "@/components/admin/field";
import { affiliateOrderBucket } from "@/lib/affiliate/shared";
import { createAffiliate, toggleAffiliate } from "./actions";
export const dynamic = "force-dynamic";
const money = (value: number) => new Intl.NumberFormat("sr-Latn-RS", { style: "currency", currency: "RSD" }).format(value);
export default async function AffiliatePage({ searchParams }: { searchParams: Promise<{ partner?: string }> }) {
  await requireAdminAction(["ADS", "OPS"], "/admin/affiliate");
  const { partner: selected } = await searchParams;
  const partners = await db.affiliatePartner.findMany({ orderBy: { createdAt: "desc" }, include: { _count: { select: { clicks: true } } } });
  const partner = partners.find(p => p.id === selected) ?? partners[0];
  const where = { affiliateClick: { partnerId: partner?.id ?? "__none__" }, channel: "WEB" as const };
  const [orders, totals] = await Promise.all([
    db.order.findMany({ where, orderBy: { createdAt: "desc" }, take: 100, select: { id: true, number: true, createdAt: true, status: true, total: true } }),
    db.order.groupBy({ by: ["status"], where, _count: { _all: true }, _sum: { total: true } }),
  ]);
  const delivered = totals.find(t => t.status === "ISPORUCENO");
  const totalOrders = totals.reduce((sum, t) => sum + t._count._all, 0);
  const pending = totals.filter(t => affiliateOrderBucket(t.status) === "pending").reduce((sum, t) => sum + t._count._all, 0);
  const excluded = totals.filter(t => affiliateOrderBucket(t.status) === "excluded").reduce((sum, t) => sum + t._count._all, 0);
  return <><PageHeader title="Affiliate partneri" description="Promo linkovi, pripisane porudžbine i realizovana prodaja na jednom mestu." />
    <main className="space-y-6 p-4 md:p-8">
      <section className="rounded-xl border bg-surface p-5"><h2 className="text-lg font-semibold">Novi partner</h2>
        <AdminActionForm action={createAffiliate} refreshOnSuccess className="mt-4 flex flex-wrap items-end gap-4">
          <Field label="Ime influencera"><input name="name" required maxLength={100} className="w-full rounded-lg border px-3 py-2" /></Field>
          <Field label="Promo kod za link"><input name="code" required minLength={3} maxLength={40} pattern="[a-z0-9][a-z0-9-]{2,39}" placeholder="ime-influencera" className="w-full rounded-lg border px-3 py-2" /></Field>
          <SubmitButton pendingLabel="Čuvanje…">Napravi partnera</SubmitButton>
        </AdminActionForm>
      </section>
      <nav aria-label="Affiliate partneri" className="flex flex-wrap gap-2">{partners.map(p => <Link key={p.id} href={`/admin/affiliate?partner=${p.id}`} aria-current={partner?.id === p.id ? "page" : undefined} className={`rounded-lg border px-4 py-2 ${partner?.id === p.id ? "bg-ink-900 text-white" : "bg-surface"}`}>{p.name}{!p.enabled ? " · Isključen" : ""}</Link>)}</nav>
      {!partner ? <p className="rounded-xl border p-8 text-center text-ink-500">Napravite prvog partnera da biste dobili promo link i pratili prodaje.</p> : <>
        <section className="space-y-3 rounded-xl border bg-surface p-5"><h2 className="text-lg font-semibold">{partner.name}</h2><p className="text-sm text-ink-500">Prosledite ovaj link influenceru. Za određeni proizvod dodajte isti parametar ?ref={partner.code} na link proizvoda.</p>
          <input aria-label="Promo link" readOnly value={`${BRAND.url.replace(/\/$/, "")}/?ref=${partner.code}`} className="w-full rounded-lg border bg-ink-50 px-3 py-3 font-mono text-sm" />
          <AdminActionForm action={toggleAffiliate} refreshOnSuccess><input type="hidden" name="id" value={partner.id} /><input type="hidden" name="enabled" value={String(!partner.enabled)} /><SubmitButton variant="outline">{partner.enabled ? "Isključi praćenje" : "Uključi praćenje"}</SubmitButton></AdminActionForm>
        </section>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{[["Praćeni dolasci", partner._count.clicks], ["Porudžbine", totalOrders], ["U obradi", pending], ["Isporučene", delivered?._count._all ?? 0], ["Vrednost isporučenih", money(Number(delivered?._sum.total ?? 0))]].map(([label, value]) => <div key={label} className="rounded-xl border bg-surface p-5"><p className="text-sm text-ink-500">{label}</p><p className="mt-2 text-2xl font-semibold">{value}</p></div>)}</div>
        <p className="text-sm text-ink-500">Poslednji partner dobija atribuciju do 30 dana od praćenog dolaska. Praćenje zahteva saglasnost za analitiku; ponovni dolazak istog partnera ne produžava rok. Otkazane i vraćene: {excluded}. Vrednost isporučenih je ukupan iznos porudžbine sa dostavom i uslugama, pre naknadnih delimičnih refundacija. Ovo nije obračun provizije niti potvrda naplate.</p>
        <section className="overflow-x-auto rounded-xl border bg-surface"><table className="w-full text-left text-sm"><caption className="p-4 text-left font-semibold">Poslednjih 100 pripisanih porudžbina · {partner.name}</caption><thead className="border-y bg-ink-50"><tr>{["Porudžbina", "Datum", "Status", "Iznos"].map(label => <th key={label} className="whitespace-nowrap p-4">{label}</th>)}</tr></thead><tbody>{orders.map(order => <tr key={order.id} className="border-b last:border-0"><td className="p-4 font-medium">{order.number}</td><td className="whitespace-nowrap p-4">{order.createdAt.toLocaleDateString("sr-Latn-RS", { timeZone: "Europe/Belgrade" })}</td><td className="p-4">{order.status.replaceAll("_", " ")}</td><td className="whitespace-nowrap p-4">{money(Number(order.total))}</td></tr>)}</tbody></table>{!orders.length && <p className="p-8 text-center text-ink-500">Još nema pripisanih porudžbina.</p>}</section>
      </>}
    </main></>;
}
