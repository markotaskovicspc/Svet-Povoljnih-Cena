"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { StatementPreview } from "@/lib/courier/finance.server";
import { previewCourierFile, confirmCourierFile, connectCourierLine } from "./actions";
const cls = "rounded-lg border border-border bg-surface px-3 py-2 text-sm";
export function CourierImportForm() {
  const [pending, start] = useTransition();
  const [preview, setPreview] = useState<StatementPreview | null>(null);
  const [message, setMessage] = useState("");
  const router = useRouter();
  const template = "tip;broj_posiljke;porudzbina;datum;tezina_kg;iznos_rsd;pdv_ukljucen;opis\n";
  return <section className="space-y-3 rounded-xl border border-border p-4">
    <h2 className="font-semibold">Uvoz kurirske specifikacije</h2>
    <p className="text-sm">GLS: originalni Excel troškova ili pouzeća. X Express: CSV/XLSX obrazac prepisan iz PDF-a. Datum označava obračun troškova ili uplatu pouzeća. U obrascu koristite TROSAK ili POUZECE, datum YYYY-MM-DD i PDV da/ne.</p>
    <a className="underline" href={`data:text/csv;charset=utf-8,${encodeURIComponent(template)}`} download="kurirski-obrazac.csv">Preuzmi CSV obrazac</a>
    <form className="flex flex-wrap gap-3" action={form => start(async () => { setPreview(null); const result = await previewCourierFile(form); if (result.ok) { setPreview(result.preview); setMessage(""); } else setMessage(result.message); })}>
      <label>Kurir <select className={cls} name="provider"><option value="MYGLS">GLS</option><option value="X_EXPRESS">X Express</option></select></label>
      <label>Broj dokumenta <input required className={cls} name="documentNo" maxLength={100}/></label>
      <label>Datum <input required className={cls} name="date" type="date"/></label>
      <label>Datoteka <input required name="file" type="file" accept=".xlsx,.csv"/></label>
      <button disabled={pending} className={cls}>Pregled pre uvoza</button>
    </form>
    {preview && <div className="space-y-2"><p>Dokument: {preview.input.documentNo} · {preview.input.filename} · {preview.input.provider}. Datum: {preview.input.rows[0].bookedOn}.</p><p>{preview.rows.length} stavki. Trošak bez PDV-a: {preview.costNet.toLocaleString("sr-RS")} RSD. Pouzeće: {preview.codGross.toLocaleString("sr-RS")} RSD.</p>
      <p>Povezano: {preview.rows.filter(r => r.status === "MATCHED").length}. Nepovezano: {preview.rows.filter(r => r.status === "UNMATCHED").length}. Višeznačno: {preview.rows.filter(r => r.status === "AMBIGUOUS").length}.</p>
      <div className="max-h-64 overflow-auto"><table className="w-full text-sm"><thead><tr><th>Pošiljka</th><th>Porudžbina</th><th>Tip</th><th>Bez PDV-a</th><th>Povezivanje</th></tr></thead><tbody>{preview.rows.map((r,i)=><tr key={i}><td>{r.trackingNo}</td><td>{r.orderNumber}</td><td>{r.kind}</td><td>{r.net}</td><td>{r.status}</td></tr>)}</tbody></table></div>
      <button disabled={pending || preview.rows.some(r => r.status === "AMBIGUOUS") || !!preview.existing && !preview.existing.same} className={cls} onClick={() => start(async () => { const result = await confirmCourierFile(preview.input, preview.fingerprint); setMessage(result.message); if(result.ok) { setPreview(null); router.refresh(); } })}>Potvrdi uvoz</button>
    </div>}
    {message && <p role="status">{message}</p>}
  </section>;
}
export function CourierLineLink({ id }: { id: string }) {
  const [pending, start] = useTransition(); const [message,setMessage] = useState(""); const router=useRouter();
  return <form action={form => start(async () => { const result=await connectCourierLine(form); setMessage(result.message); if(result.ok)router.refresh(); })} className="flex flex-wrap gap-2"><input name="id" type="hidden" value={id}/><input name="trackingNo" aria-label="Tačan broj pošiljke" required maxLength={100} placeholder="Tačan broj pošiljke" className={cls}/><button disabled={pending} className={cls}>Poveži</button><span role="status">{message}</span></form>;
}
