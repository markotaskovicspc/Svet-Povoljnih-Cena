import Link from "next/link";
import { requireAdminAction } from "@/lib/admin";
import { allowedRolesForErpModule } from "@/lib/admin/erp-access";
import { PageHeader } from "@/components/admin/page-header";
import { StatCard } from "@/components/admin/card";
import { DataTable } from "@/components/admin/data-table";
import { REPORT_PERIOD_PRESETS, resolveReportPeriod } from "@/lib/admin/report-period";
import { getExitIntentReport } from "@/lib/admin/exit-intent-report.server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Exit-intent ponuda · Analitika", robots: { index: false, follow: false } };
const percent = (n: number, d: number) => d ? `${(100 * n / d).toLocaleString("sr-Latn-RS", { maximumFractionDigits: 1 })}%` : "—";
const money = (n: number) => `${n.toLocaleString("sr-Latn-RS", { maximumFractionDigits: 0 })} RSD`;

export default async function ExitIntentReport({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdminAction(allowedRolesForErpModule("exit-intent"));
  const params = await searchParams;
  const field = (name: string) => typeof params[name] === "string" ? params[name].slice(0, 30) : undefined;
  const period = resolveReportPeriod({ range: field("range"), from: field("from"), to: field("to") });
  const report = await getExitIntentReport(period);
  const total = report.find(row => row.day === null)!;
  const inputClass = "rounded-lg border border-border/60 bg-white px-3 py-2 text-sm";
  return <>
    <PageHeader title="Exit-intent ponuda" description="Da li ponuda za prvu kupovinu zadržava posetioce koji kreću da napuste sajt?" actions={<Link href="/admin/erp/posete-konverzije" className="text-sm underline">Posete i konverzije</Link>} />
    <div className="space-y-6 p-6 lg:p-8">
      <form className="flex flex-wrap items-end gap-3 rounded-xl border border-border/60 bg-surface p-4">
        <label className="grid gap-1 text-xs">Period<select name="range" defaultValue={period.preset} className={inputClass}>{REPORT_PERIOD_PRESETS.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}<option value="custom">Odabrani datumi</option></select></label>
        <label className="grid gap-1 text-xs">Od<input type="date" name="from" defaultValue={period.fromInput} className={inputClass} /></label>
        <label className="grid gap-1 text-xs">Do<input type="date" name="to" defaultValue={period.toInput} className={inputClass} /></label>
        <button className="rounded-lg bg-ink-900 px-5 py-2 text-sm font-semibold text-white">Prikaži</button>
      </form>
      <p className="text-sm text-ink-600">Rezultati posetilaca kojima je ponuda prikazana u periodu {period.fromInput} – {period.toInput}. Sve metrike obuhvataju samo pregledače sa prihvaćenom analitikom.</p>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Videli ponudu" value={String(total.visitors)} hint={`${total.impressions} prikazivanja · jedinstveni pregledači`} />
        <StatCard label="Kliknuli na ponudu" value={String(total.clicked)} hint={`${percent(total.clicked, total.visitors)} posetilaca koji su videli ponudu`} />
        <StatCard label="Ostali aktivni 30 sekundi" value={String(total.retained)} hint={`${percent(total.retained, total.visitors)} · posle zatvaranja, uz korišćenje sajta`} />
        <StatCard label="Poručili posle ponude" value={String(total.buyers)} hint={`${percent(total.buyers, total.visitors)} · u roku od 7 dana`} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Povezane porudžbine" value={String(total.orders)} hint="Bez otkazanih, vraćenih i potpuno refundiranih" />
        <StatCard label="Sa popustom za prvu kupovinu" value={String(total.discountedOrders)} hint="Stvarno obračunat popust na povezanoj porudžbini" />
        <StatCard label="Plaćene ili isporučene" value={String(total.paidOrders)} hint="Podskup povezanih porudžbina prema trenutnom statusu" />
        <StatCard label="Vrednost poručenih artikala" value={money(total.orderValue)} hint="Posle popusta, bez dostave i montaže · nije naplaćeni promet" />
      </div>
      <div className="rounded-xl border border-border/60 bg-surface p-4 text-sm leading-relaxed">
        Klik na registraciju: <strong>{total.registered}</strong> · Klik na prijavu: <strong>{total.loggedIn}</strong> · Prijavljeni nastavili kupovinu: <strong>{total.shopClicked}</strong> · Zatvorili bez izbora ponude: <strong>{total.dismissed}</strong>.
        <p className="mt-1 text-ink-600">Ovo su klikovi, ne potvrđene registracije. Isti pregledač može pripadati više grupa.</p>
      </div>
      <DataTable columns={[
        { key: "day", label: "Dan prikaza" }, { key: "views", label: "Videli / prikazi" },
        { key: "clicks", label: "Kliknuli" }, { key: "stayed", label: "Ostali 30 s" },
        { key: "buyers", label: "Poručili / stopa" }, { key: "orders", label: "Porudžbine / sa popustom" },
        { key: "paid", label: "Plaćene ili isporučene" }, { key: "value", label: "Artikli bez dostave" },
      ]} rows={report.filter(row => row.day).map(row => ({ id: row.day!, cells: {
        day: row.day, views: `${row.visitors} / ${row.impressions}`, clicks: String(row.clicked), stayed: String(row.retained),
        buyers: `${row.buyers} / ${percent(row.buyers, row.visitors)}`, orders: `${row.orders} / ${row.discountedOrders}`,
        paid: String(row.paidOrders), value: money(row.orderValue),
      } }))} empty="Još nema izmerenih prikaza ponude za odabrani period. Merenje počinje objavom popupa." />
      <div className="space-y-2 text-sm leading-relaxed text-ink-600">
        <p>Ponuda se prikazuje na računaru pri izlasku kursora preko gornje ivice prozora, posle najmanje 15 sekundi na stranici. Najviše jednom u 7 dana po pregledaču. Ne otvara se tokom naplate, prijave ni preko drugog dijaloga.</p>
        <p>„Ostali aktivni” znači najmanje 30 sekundi sa sajtom u prvom planu, nakon interakcije van popupa, u prvih 30 minuta od prikaza. Vreme u skrivenom tabu, samo zatvaranje ponude i kasniji povratak drugog dana se ne računaju.</p>
        <p>Porudžbina se povezuje sa poslednjim prikazom ponude u istom pregledaču tokom prethodnih 7 dana, i kada nije bilo klika na ponudu. Broji se jednom i potvrđuje serverskim zapisom o kreiranju. Drugi uređaji i posetioci bez saglasnosti ne mogu se povezati. Dnevne grupe mogu da se preklapaju; ukupan broj pregledača se računa zasebno.</p>
        <p>Ovo pokazuje šta se desilo nakon ponude, ali bez kontrolne grupe ne dokazuje da je popup izazvao kupovinu. Rezultati za poslednjih 7 dana još mogu da rastu. Datumi su po vremenu u Srbiji.</p>
      </div>
    </div>
  </>;
}
