import Link from "next/link";
import { requireAdminAction } from "@/lib/admin";
import { canAccessAdminModule } from "@/lib/admin/access-policy";
import { PageHeader } from "@/components/admin/page-header";
import { StatCard } from "@/components/admin/card";
import { DataTable } from "@/components/admin/data-table";
import { formatRsd } from "@/lib/format";
import { REPORT_PERIOD_PRESETS, resolveReportPeriod } from "@/lib/admin/report-period";
import { getOrderBumpReport } from "@/lib/admin/order-bump-report.server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Order bump · Analitika", robots: { index: false, follow: false } };

export default async function OrderBumpReport({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const admin = await requireAdminAction(["ADS", "OPS"], "/admin/erp/order-bump");
  const params = await searchParams;
  const field = (key: string) => (Array.isArray(params[key]) ? params[key][0] : params[key])?.slice(0, 120) || "";
  const period = resolveReportPeriod({ range: field("range"), from: field("from"), to: field("to") });
  const { total, rows, engagement } = await getOrderBumpReport(period);
  const inputClass = "rounded-lg border border-border/60 bg-white px-3 py-2 text-sm";

  return <>
    <PageHeader title="Order bump" description="Kupovine preko dodatnih ponuda u korpi, sa odvojenim rezultatom isporuke."
      actions={canAccessAdminModule(admin, "/admin/preporuke", ["CONTENT"]) ? <Link className="text-sm underline" href="/admin/preporuke">Podesi povezane proizvode</Link> : undefined} />
    <div className="space-y-6 p-6 lg:p-8">
      <form className="grid gap-3 rounded-xl border border-border/60 bg-surface p-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className="grid gap-1 text-xs">Period<select className={inputClass} name="range" defaultValue={period.preset}>{REPORT_PERIOD_PRESETS.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}<option value="custom">Odabrani datumi</option></select></label>
        <label className="grid gap-1 text-xs">Od<input type="date" name="from" defaultValue={period.fromInput} className={inputClass} /></label>
        <label className="grid gap-1 text-xs">Do<input type="date" name="to" defaultValue={period.toInput} className={inputClass} /></label>
        <button className="self-end rounded-lg bg-brand-blue px-4 py-2 text-sm font-semibold text-white">Prikaži rezultate</button>
      </form>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Porudžbine sa dodatkom" value={String(total.orders)} hint={`${total.units} komada preko order bumpa · bez otkazanih i vraćenih`} />
        <StatCard label="Isporučene porudžbine" value={String(total.delivered)} hint="Potvrđena isporuka, prema trenutnom statusu" tone="success" />
        <StatCard label="Vrednost dodatih artikala" value={formatRsd(total.revenue)} hint={`Isporučeno: ${formatRsd(total.deliveredRevenue)} · posle popusta`} />
        <StatCard label="Otkazane / vraćene" value={String(total.excluded)} hint="Izdvojene iz porudžbina i vrednosti dodataka" tone="warning" />
      </div>
      <DataTable columns={[
        { key: "product", label: "Dodatni proizvod" }, { key: "source", label: "Uz artikal / ponuda" },
        { key: "orders", label: "Porudžbine", align: "right" }, { key: "units", label: "Komadi", align: "right" },
        { key: "delivered", label: "Isporučene", align: "right" }, { key: "excluded", label: "Otkazane / vraćene", align: "right" },
        { key: "revenue", label: "Vrednost dodataka", align: "right" },
      ]} rows={rows.map((row, index) => ({ id: String(index), cells: {
        product: <><strong>{row.name}</strong><div className="text-xs text-ink-500">{row.sku}</div></>,
        source: <>{row.sourceSku}<div className="text-xs text-ink-500">{row.offerId}</div></>,
        orders: row.orders, units: row.units, delivered: row.delivered, excluded: row.excluded, revenue: formatRsd(row.revenue),
      } }))} empty="Još nema porudžbina preko order bumpa u ovom periodu." />
      <p className="text-sm leading-6 text-ink-500">Brojimo porudžbine koje sadrže artikal dodat dugmetom u ovoj ponudi. Uklonjen dodatak se ne računa. Svaka porudžbina u zbiru se broji jednom, čak i kada ima više dodataka. Prikazan je datum kreiranja porudžbine i njen trenutni status. Vrednost obuhvata samo označene komade, uz srazmerno raspoređene popuste; ne uključuje dostavu i montažu i nije obračun profita.</p>
      <div className="space-y-3 border-t border-border/60 pt-5">
        <h2 className="text-base font-semibold">Prikazi i dodavanja · uz saglasnost za analitiku</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <StatCard label="Videli dodatnu ponudu" value={String(engagement.viewers)} hint="Jedinstveni pregledači sa prihvaćenom analitikom" />
          <StatCard label="Dodali preko ponude" value={String(engagement.adders)} hint="Uspešna dodavanja, nakon provere dostupnosti" />
        </div>
        <p className="text-xs leading-5 text-ink-500">Ovaj deo meri samo pregledače sa saglasnošću i ne predstavlja sve kupce. Broj porudžbina iznad čuva se na samim stavkama, nezavisno od saglasnosti za analitiku. Merenje počinje objavom ove funkcije.</p>
      </div>
    </div>
  </>;
}
