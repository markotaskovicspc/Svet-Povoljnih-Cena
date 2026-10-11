import { requireAdminAction } from "@/lib/admin";
import { resolveReportPeriod, REPORT_PERIOD_PRESETS } from "@/lib/admin/report-period";
import { courierFinanceReport } from "@/lib/courier/finance-report.server";
import { carrierName } from "@/lib/courier/finance";
import { PageHeader } from "@/components/admin/page-header";
import { CourierImportForm, CourierLineLink } from "./import-form";
export const dynamic = "force-dynamic";
export const metadata = { title: "Kurirski obračun · ERP", robots: { index: false, follow: false } };
const rsd = (value: number | null) => value == null ? "Nedostaje podatak" : `${value.toLocaleString("sr-RS", {minimumFractionDigits:2})} RSD`;
export default async function Page({ searchParams }: { searchParams: Promise<Record<string,string | string[] | undefined>> }) {
  await requireAdminAction(["OPS"]);
  const params=await searchParams; const first=(key:string)=>Array.isArray(params[key]) ? params[key][0] : params[key];
  const period=resolveReportPeriod({range:first("range"),from:first("from"),to:first("to")});
  const report=await courierFinanceReport(period,first("provider"));
  return <><PageHeader title="Kurirski obračun" description="Troškovi dostave, odstupanja i uplata pouzeća." crumbs={[{href:"/admin",label:"Admin"},{label:"Kurirski obračun"}]}/><div className="space-y-6 px-4 py-6 md:px-8">
    <form className="flex flex-wrap gap-3"><select name="range" defaultValue={period.preset}>{REPORT_PERIOD_PRESETS.map(p=><option key={p.key} value={p.key}>{p.label}</option>)}<option value="custom">Tačan raspon</option></select><input name="from" type="date" defaultValue={period.fromInput} aria-label="Od"/><input name="to" type="date" defaultValue={period.toInput} aria-label="Do"/><select name="provider" defaultValue={first("provider") ?? "ALL"}><option value="ALL">Svi kuriri</option><option value="MYGLS">GLS</option><option value="X_EXPRESS">X Express</option></select><button>Primeni</button></form>
    <CourierImportForm/>
    <p className="text-sm">Zbirni troškovi i pouzeće koriste datum specifikacije. Fiskalizovana dostava koristi datum izdavanja računa, umanjena za refundacije. Trošak po pošiljci prikazan je pri uručenju ili povratu, u jednom smeru. Osnovna procena koristi sačuvanu težinu poslatu kuriru; gorivo, obaveštenja i posebne usluge nisu u osnovnoj proceni. Za ranije pošiljke bez sačuvane težine procena nije dostupna.</p>
    <div className="grid gap-4 md:grid-cols-2">{report.totals.map(t=><section key={t.provider} className="rounded-xl border border-border p-4"><h2 className="font-semibold">{carrierName(t.provider)}</h2><p>Trošak iz specifikacija bez PDV-a: {rsd(t.costNet)}</p><p>Uplaćeno pouzeće: {rsd(t.cod)}</p><p>Fiskalizovana dostava sa PDV-om: {rsd(t.fiscalShipping)}</p></section>)}</div>
    <p>Neraspoređena fiskalizovana dostava (bez jedinstvenog kurira): {rsd(report.unallocatedFiscal)}</p>
    {report.legacyCount > 0 && <p role="status">{report.legacyCount} starih fiskalnih računa nema stavke iz kojih je moguće izdvojiti dostavu. Njihova dostava nije uključena u zbir.</p>}
    <h2 className="font-semibold">Uručene i vraćene pošiljke u periodu</h2>
    <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr>{["Datum","Porudžbina","Kurir / pošiljka","Status","Osnovna procena bez PDV-a","Fakturisano bez PDV-a (sve specifikacije)","Razlika prema osnovi","Očekivano pouzeće","Uplaćeno ukupno","Kontrola pouzeća"].map(h=><th key={h} className="p-2 text-left">{h}</th>)}</tr></thead><tbody>{report.rows.map(r=><tr key={r.id} className="border-t border-border"><td className="p-2">{r.date}</td><td><a className="underline" href={`/admin/porudzbine/${r.orderId}`}>{r.orderNumber}</a></td><td>{carrierName(r.provider)} {r.trackingNo}</td><td>{r.status}</td><td>{rsd(r.base)}</td><td>{rsd(r.actual)}</td><td>{rsd(r.difference)}</td><td>{rsd(r.expectedCod)}</td><td>{rsd(r.cod)}</td><td>{r.codStatus === "SETTLED" ? "Usklađeno" : r.codStatus === "SHORT" ? "Manjak" : r.codStatus === "EXCESS" ? "Višak" : "Nepoznato"}</td></tr>)}</tbody></table>{!report.rows.length && <p>Nema pošiljki u ovom periodu.</p>}</div>
    <h2 className="font-semibold">Nepovezane stavke specifikacija</h2>{report.unmatched.map(l=><section key={l.id} className="rounded-xl border border-border p-3"><p>{carrierName(l.provider)} · {l.documentNo} · {l.trackingNo} · {l.kind} · {rsd(l.amount)}</p><CourierLineLink id={l.id}/></section>)}{!report.unmatched.length && <p>Nema nepovezanih stavki.</p>}
  </div></>;
}
