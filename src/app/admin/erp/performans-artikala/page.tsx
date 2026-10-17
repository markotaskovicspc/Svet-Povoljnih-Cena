import Link from 'next/link';
import { PerformanceFilters } from '@/components/admin/performance-filters';
import { requireAdminAction } from '@/lib/admin';
import { PageHeader } from '@/components/admin/page-header';
import { StatCard, Card, CardTitle } from '@/components/admin/card';
import { DataTable } from '@/components/admin/data-table';
import { getProductPerformance } from '@/lib/admin/product-performance.server';
import { PERFORMANCE_SORTS, sortProductPerformance, summarizeProductPerformance, type PerformanceSort } from '@/lib/admin/product-performance';
import { dateInputInTimeZone, resolveReportPeriod } from '@/lib/admin/report-period';
import { formatRsd } from '@/lib/format';
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Performans artikala', robots: { index: false, follow: false } };
const format = (value: number | null) => value === null ? '—' : value.toLocaleString('sr-Latn-RS', { maximumFractionDigits: 2 });
const money = (value: number | null) => value === null ? '—' : formatRsd(value);
export default async function ProductPerformancePage({ searchParams }: { searchParams: Promise<Record<string,string|string[]|undefined>> }) {
  await requireAdminAction(['OPS']);
  const raw = await searchParams, params = Object.fromEntries(Object.entries(raw).map(([k,v]) => [k,Array.isArray(v)?v[0]:v]));
  const now = new Date(), period = resolveReportPeriod({ range: params.range, from: params.from, to: params.to }, now);
  const sort = PERFORMANCE_SORTS.includes(params.sort as PerformanceSort) ? params.sort as PerformanceSort : 'revenue';
  const direction = params.direction === 'asc' ? 'asc' : 'desc';
  const tooLong = period.endExclusive.getTime() - period.start.getTime() > 367 * 86400_000;
  const all = tooLong ? [] : await getProductPerformance(period, now), summary = summarizeProductPerformance(all);
  const q = (params.q ?? '').trim().slice(0,100);
  const filtered = all.filter(row => (row.sku+' '+row.name).toLocaleLowerCase('sr-Latn').includes(q.toLocaleLowerCase('sr-Latn')));
  const requestedPage = Number(params.page), page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? Math.min(requestedPage,Math.max(1,Math.ceil(filtered.length/50))) : 1;
  const rows = sortProductPerformance(filtered, sort, direction).slice((page-1)*50,page*50);
  const href = (extra: Record<string,string>) => '/admin/erp/performans-artikala?' + new URLSearchParams({ range: period.preset, from: period.fromInput, to: period.toInput, q, sort, direction, ...extra }).toString();
  const fields: [PerformanceSort,string][] = [['sku','SKU'],['name','Artikal'],['quantity','Prodato kom'],['revenue','Neto prodaja RSD'],['netRevenuePerDay','Neto prodaja na dan RSD'],['netQuantityPerDay','Prosek kom po kalendarskom danu'],['averageRetailPrice','Prosečna MPC RSD'],['dailyQty','Prosek kom/dan na lageru'],['dailyRevenue','Prosek RSD/dan na lageru'],['availableDays','Dani sa zalihama'],['cogs','COGS RSD'],['averageStockValue','Prosečne zalihe RSD'],['estimatedKoz','KOZ'],['stock','Trenutni lager'],['coverageDays','Dani pokrića']];
  return <><PageHeader title="Performans artikala" description="Prodaja našeg sajta · fiskalizovana roba sa PDV-om, umanjena za refundacije · vreme u Srbiji" crumbs={[{href:'/admin',label:'Admin'},{href:'/admin/izvestaji',label:'Izveštaji'},{label:'Performans artikala'}]}/>
    <div className="space-y-5 px-4 py-5 md:px-8">
      <details className="group rounded-xl border border-border bg-surface">
        <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 p-4 text-sm font-medium text-ink-900 [&::-webkit-details-marker]:hidden">
          <span>Period, filteri i objašnjenje pokazatelja</span>
          <span className="flex items-center gap-3 text-xs text-ink-500"><span>{period.label}{q ? ` · ${q}` : ''}</span><span className="transition-transform group-open:rotate-180" aria-hidden="true">⌄</span></span>
        </summary>
        <div className="space-y-4 border-t border-border p-4">
          <PerformanceFilters key={period.fromInput+period.toInput+period.preset} preset={period.preset} fromInput={period.fromInput} toInput={period.toInput} q={q} sort={sort} direction={direction} today={dateInputInTimeZone(now)}/>
          <div className="rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm text-ink-700">KOZ koristi istorijsku vrednost zaliha: količinu lagera i cenu koja je važila u tom trenutku. Prednost ima sačuvani fiskalni COGS, zatim rekonstruisano knjiženje nabavke, pa nabavni cenovnik u RSD sa datumima važenja. Cenovnik može biti bez transporta i carine; takve vrednosti i rekonstrukcije su označene kao procena. Današnja cena i današnji kurs ne koriste se za prošlost. Nepotpuna ili neusaglašena istorija lagera daje „—“, ne nulu. Dani na lageru računaju se kada je sopstveni lager bio pozitivan; dobavljačeve zalihe nisu uključene.</div>
          <p className="mt-3 text-xs text-ink-500">Prosek kom po kalendarskom danu: neto prodati komadi ÷ svi dani perioda do danas; ne zahteva istoriju lagera. Neto prodaja na dan: neto fiskalna prodaja robe ÷ svi kalendarski dani izabranog perioda do danas, uključujući dane bez prodaje i lagera. Prosečna MPC: neto prodaja robe sa PDV-om ÷ neto prodati komadi, posle refundacija; — ako nema pozitivne neto količine. Prosek prodaje na lageru: samo fiskalna prodaja sajta u poznatim danima sa raspoloživim zalihama ÷ broj takvih dana. Pokriće: trenutni pozitivan lager ÷ prosečna dnevna količina; — ako nema pozitivne prodaje. Prosečna vrednost lagera je vremenski ponderisana uz svaku promenu količine ili istorijske cene. KOZ asortimana koristi zbir COGS-a ÷ zbir prosečnih vrednosti, ne prosek KOZ-ova po artiklu.</p>
        </div>
      </details>
      {tooLong ? <p role="alert">Izaberite period do godinu dana.</p> : <>
        <p className="text-sm text-ink-500">Ukupni asortiman · {summary.count} artikala sa lagerom ili istorijom · {period.label} · {summary.completeCount} sa potpunom istorijom količine u periodu. Pretraga po SKU-u ili nazivu ne menja zbirne pokazatelje.</p>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><StatCard label="Neto prodaja sajta" value={money(summary.revenue)} hint={`${format(summary.quantity)} kom · bez dostave i montaže`}/><StatCard label="COGS prodate robe" value={money(summary.cogs)} hint={`Fiskalni COGS; ${summary.estimatedCogsCount} artikala dopunjeno istorijskom cenom`}/><StatCard label="Prosečne zalihe" value={money(summary.averageStockValue ?? summary.knownStockValue)} hint={`${summary.costHistoryCount} od ${summary.count} artikala sa istorijom vrednosti${summary.averageStockValue === null ? "; delimičan zbir poznatih vrednosti" : ""}; ${summary.estimatedCount} sa procenom`}/><StatCard label={summary.estimatedKoz === null ? "KOZ dokumentovanih artikala" : "KOZ asortimana"} value={format(summary.estimatedKoz ?? summary.documentedKoz)} hint={`${summary.documentedCount} od ${summary.count} artikala sa poznatim COGS-om i prosečnim zalihama; isti artikli u oba zbira`}/></div>

        <Card><CardTitle description="Kliknite naziv kolone za najbolje/najgore rezultate u celom izboru. Nepoznate vrednosti su uvek na kraju.">Po artiklu</CardTitle>
          <DataTable stickyHeader columns={fields.map(([key,label])=>({key,label,align:key==='sku'||key==='name'?'left':'right',sortHref:href({sort:key,direction:sort===key&&direction==='desc'?'asc':'desc',page:'1'}),sortDirection:sort===key?direction:undefined}))} rows={rows.map(row=>({id:row.id,cells:Object.fromEntries(fields.map(([key])=>[key,key==='sku'?<Link href={`/admin/erp/artikli/${row.id}`} className="font-mono text-xs text-walnut">{row.sku}</Link>:key==='name'?row.name:key==='cogs'?<span>{money(row.cogs)}{row.estimatedSalesCogs&&<span className="block text-xs text-ink-500">Istorijska cena · procena</span>}</span>:key==='averageStockValue'?<span>{money(row.averageStockValue)}<span className="block text-xs text-ink-500">{row.valuationBasis==='missing'?(row.historyStatus==='unreconciled'?'Lager nije usaglašen':row.historyStatus==='incomplete-stock'?'Nedostaje istorija količine':'Nedostaje istorijska cena'):row.valuationBasis==='zero-stock'?'Bez lagera u periodu':row.valuationBasis==='fiscal'?'Istorijski COGS':row.valuationBasis==='booking'?'Knjiženje · procena':row.valuationBasis==='purchase-prices'?'Cenovnik · procena':'Više izvora · procena'}</span></span>:['revenue','cogs','dailyRevenue','netRevenuePerDay','averageRetailPrice'].includes(key)?money(row[key] as number|null):format(row[key] as number|null)]))}))} empty="Nema artikala za izabrani filter."/>

          <div className="mt-4 flex justify-between text-sm">{page>1?<Link href={href({page:String(page-1)})}>← Prethodni</Link>:<span/>}<span>{page} / {Math.max(1,Math.ceil(filtered.length/50))} · {filtered.length} artikala</span>{page*50<filtered.length?<Link href={href({page:String(page+1)})}>Sledeći →</Link>:<span/>}</div>
        </Card>
      </>}
    </div></>;
}
