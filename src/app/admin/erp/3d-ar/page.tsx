import Link from "next/link";
import { requireAdminAction } from "@/lib/admin";
import { allowedRolesForErpModule } from "@/lib/admin/erp-access";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/admin/page-header";
import { StatCard } from "@/components/admin/card";
import { DataTable } from "@/components/admin/data-table";
import { REPORT_PERIOD_PRESETS, resolveReportPeriod } from "@/lib/admin/report-period";
import { getProductArReport, getProductArCounts, type ArReportFilters } from "@/lib/admin/product-ar-report.server";
import { AR_EXPERIMENT, AR_EXPERIMENTS } from "@/lib/analytics/product-ar-events";
import { getProductArSlugs } from "@/lib/product-ar";
export const dynamic = "force-dynamic";
export const metadata = { title: "3D i AR · Analitika", robots: { index: false, follow: false } };
const percent = (n: number, d: number) => d ? `${(100 * n / d).toLocaleString("sr-Latn-RS", { maximumFractionDigits: 1 })}%` : "—";

export default async function ProductArReport({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdminAction(allowedRolesForErpModule("3d-ar"));
  const params = await searchParams;
  const field = (key: string) => (Array.isArray(params[key]) ? params[key][0] : params[key])?.slice(0, 120) || "";
  const period = resolveReportPeriod({ range: field("range"), from: field("from"), to: field("to") });
  const experiment = field("experiment") === "ar-copy-v1" ? "ar-copy-v1" : AR_EXPERIMENT;
  const copy = AR_EXPERIMENTS[experiment];
  const filters: ArReportFilters = { experiment, product: field("product"), campaign: field("campaign"), content: field("content"), source: field("source"), device: field("device"), variant: field("variant") };
  const [report, products, counts] = await Promise.all([getProductArReport(period, filters), db.product.findMany({ where: { OR: [{ analyticsEvents: { some: { type: "PRODUCT_AR" } } }, { slug: { in: getProductArSlugs() } }] }, select: { id: true, name: true, sku: true }, orderBy: { name: "asc" } }), getProductArCounts(period, filters.product)]);
  const total = report.find(row => row.total === 1)!;
  const rows = report.filter(row => !row.total);
  const selectClass = "rounded-lg border border-border/60 bg-white px-3 py-2 text-sm";
  const columns = [{ key: "product", label: "Proizvod / reklama" }, { key: "variant", label: "Poruka / uređaj" }, { key: "exposure", label: "Videli 3D / AR" }, { key: "model", label: "Otvorili / koristili 3D" }, { key: "ar", label: "AR klik / pokušali" }, { key: "qr", label: "QR prikazan / otvoren" }, { key: "conversion", label: "Korpa / poručili" }, { key: "rate", label: "AR klik / kupovina %" }];
  return <>
    <PageHeader title="3D i AR" description="Korišćenje modela, pokušaji AR-a i rezultat dve poruke na dugmetu." actions={<Link className="text-sm underline" href="/admin/erp/posete-konverzije">Posete i konverzije</Link>} />
    <div className="space-y-6 p-6 lg:p-8">
      <form className="grid gap-3 rounded-xl border border-border/60 bg-surface p-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className="grid gap-1 text-xs">Period<select className={selectClass} name="range" defaultValue={period.preset}>{REPORT_PERIOD_PRESETS.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}<option value="custom">Odabrani datumi</option></select></label>
        <label className="grid gap-1 text-xs">Od<input type="date" name="from" defaultValue={period.fromInput} className={selectClass} /></label>
        <label className="grid gap-1 text-xs">Do<input type="date" name="to" defaultValue={period.toInput} className={selectClass} /></label>
        <label className="grid gap-1 text-xs">Proizvod<select name="product" defaultValue={filters.product} className={selectClass}><option value="">Svi proizvodi</option>{products.map(p => <option key={p.id} value={p.id}>{p.sku} · {p.name}</option>)}</select></label>
        <label className="grid gap-1 text-xs">Kampanja (utm_campaign)<input name="campaign" defaultValue={filters.campaign} className={selectClass} /></label>
        <label className="grid gap-1 text-xs">Oglas (utm_content)<input name="content" defaultValue={filters.content} className={selectClass} /></label>
        <label className="grid gap-1 text-xs">Izvor (utm_source)<input name="source" defaultValue={filters.source} className={selectClass} /></label>
        <label className="grid gap-1 text-xs">Uređaj<select name="device" defaultValue={filters.device} className={selectClass}><option value="">Svi uređaji</option><option value="desktop">Računar</option><option value="android">Android</option><option value="ios">iPhone / iPad</option></select></label>
        <label className="grid gap-1 text-xs">Verzija poruka<select name="experiment" defaultValue={experiment} className={selectClass}><option value="ar-copy-v2">Aktuelna · v2</option><option value="ar-copy-v1">Prethodna · v1</option></select></label>
        <label className="grid gap-1 text-xs">Poruka<select name="variant" defaultValue={filters.variant} className={selectClass}><option value="">A i B</option><option value="A">A · {copy.A}</option><option value="B">B · {copy.B}</option></select></label>
        <button className="rounded-lg bg-ink-900 px-4 py-2 text-sm font-semibold text-white">Prikaži rezultate</button>
      </form>
      <section className="space-y-3" aria-labelledby="aggregate-heading">
        <h2 id="aggregate-heading" className="text-lg font-semibold">Zbirno korišćenje · svi posetioci</h2>
        <p className="text-sm text-ink-600">Broj radnji, ne jedinstvenih ljudi. Uključuje i posetioce bez prihvaćene analitike. Važe samo filteri datuma i proizvoda; kampanje, uređaji i A/B poruke nisu zabeleženi u ovim brojačima.</p>
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard label="Otvaranja 3D prikaza" value={String(counts.opened)} hint="Uspešno učitan aktivirani model" />
          <StatCard label="Klikovi na AR dugme" value={String(counts.clicked)} hint="Telefon: AR poziv · računar: QR" />
          <StatCard label="QR dolasci telefonom" value={String(counts.qrLanded)} hint="Otvoren AR link, bez potvrde postavljanja" />
        </div>
        <p className="text-xs text-ink-600">Brojači počinju od objave ove funkcije. Ponovne posete mogu se brojati ponovo, a blokirani zahtevi i greške mogu umanjiti rezultat. Ove brojeve ne sabirati sa detaljnom analitikom ispod, jer se preklapaju.</p>
      </section>
      <h2 className="text-lg font-semibold">Detaljna analitika · samo uz saglasnost</h2>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Otvorili 3D" value={String(total.opened)} hint={`${total.used} je rotiralo ili zumiralo model`} />
        <StatCard label="Kliknuli AR" value={String(total.clicked)} hint={`${total.arExposed} je videlo AR dugme · ${percent(total.clicked, total.arExposed)} kliknulo`} />
        <StatCard label="Pokušali AR" value={String(total.attempted)} hint={`${total.attempts} ukupnih pokušaja · nije potvrda postavljanja u sobu`} />
        <StatCard label="Poručili posle korišćenja" value={String(total.engagedBuyers)} hint={`${total.engagedCarts} je dodalo ovaj proizvod u korpu posle 3D interakcije ili AR pokušaja`} />
      </div>
      <DataTable columns={columns} rows={rows.map((row, index) => ({ id: String(index), cells: {
        product: <><strong>{row.name}</strong><div className="text-xs">{row.sku} · {row.source || "direct"} / {row.campaign || "bez kampanje"} / {row.content || "bez oznake oglasa"}</div></>,
        variant: <>{row.variant} · {copy[row.variant as "A" | "B"]}<div className="text-xs">{row.device}</div></>,
        exposure: `${row.photoExposed} / ${row.arExposed}`, model: `${row.opened} / ${row.used}`, ar: `${row.clicked} / ${row.attempted}`, qr: `${row.qrShown} / ${row.qrLanded}`,
        conversion: `${row.carts} / ${row.buyers}`, rate: `${percent(row.clicked, row.arExposed)} / ${percent(row.buyers, row.arExposed)}`,
      } }))} empty="Još nema izmerenih 3D/AR događaja za odabrane filtere." />
      <div className="space-y-2 text-sm text-ink-600">
        <p>A/B test: A — „{copy.A}”; B — „{copy.B}”. Dodela je nasumična 50/50 i ostaje ista u pregledaču. Poređenje kupovine obuhvata sve koji su videli AR dugme, uključujući one koji ga nisu koristili.</p>
        <p>Brojevi su jedinstveni pregledači sa prihvaćenom analitikom, uz izuzetak ukupnog broja AR pokušaja. Pozadinsko učitavanje nije otvaranje 3D-a. QR „otvoren” znači dolazak na AR link telefonom; više uređaja iste osobe može se brojati odvojeno.</p>
        <p>Korpa i poručivanje se povezuju sa istim proizvodom i pregledačem tokom 30 dana posle prikaza AR dugmeta; poslednja kartica meri period posle korišćenja 3D-a ili pokušaja AR-a. Poručivanje nije potvrda naplate. Rezultati novijih grupa još mogu da rastu. Poređenje korisnika i nekorisnika samo po sebi ne dokazuje uticaj na kupovinu.</p>
        <p>Kampanja i uređaj pripadaju prvom izmerenom 3D/AR događaju tog pregledača za proizvod u odabranom periodu. {total.failures} pregledača je dobilo zabeleženu grešku. Scene Viewer i Quick Look ne potvrđuju sajtu uspešno postavljanje predmeta.</p>
      </div>
    </div>
  </>;
}
