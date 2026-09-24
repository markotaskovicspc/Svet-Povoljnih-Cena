"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { previewActionPriceImport, applyActionPriceImport } from "@/app/admin/erp/akcije/import-actions";
import { formatRsd } from "@/lib/format";
type Preview = Extract<Awaited<ReturnType<typeof previewActionPriceImport>>, { ok: true }>;
export function ActionPriceImport({ actionId }: { actionId: string }) {
  const router = useRouter();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function inspect(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget); data.set("actionId", actionId);
    setBusy(true); setMessage(""); setPreview(null);
    try { const result = await previewActionPriceImport(data); if (result.ok) setPreview(result); else setMessage(result.error); }
    catch { setMessage("Pregled nije uspeo. Pokušajte ponovo."); }
    finally { setBusy(false); }
  }
  async function apply() {
    if (!preview || busy) return;
    const data = new FormData(); data.set("actionId", actionId); data.set("rows", JSON.stringify(preview.input)); data.set("fingerprint", preview.preview.fingerprint);
    setBusy(true); setMessage("");
    try { const result = await applyActionPriceImport({ ok: false, message: "" }, data); setMessage(result.message); if (result.ok) { setPreview(null); router.refresh(); } }
    catch { setMessage("Primena nije potvrđena. Ponovite pregled da proverite stanje pre novog pokušaja."); }
    finally { setBusy(false); }
  }
  return <details className="m-4 rounded-xl border border-border bg-surface p-4">
    <summary className="cursor-pointer font-semibold">Uvoz akcijskih cena (CSV / XLSX)</summary>
    <p className="mt-3 text-sm text-ink-600">Kolone: Šifra i Akcijska cena. Do 500 artikala, datoteka do 500 KB. Koristite pune interne šifre kao tekst, da sačuvate početne nule. Uvoz dodaje ili ažurira samo navedene artikle u ovoj akciji.</p>
    <form onSubmit={inspect} className="mt-3 flex flex-wrap items-center gap-3">
      <input aria-label="Datoteka sa akcijskim cenama" name="file" type="file" accept=".csv,.xlsx" required disabled={busy} onChange={() => { setPreview(null); setMessage(""); }} className="max-w-full text-sm" />
      <button type="submit" disabled={busy} className="rounded-lg border border-border px-4 py-2 text-sm disabled:opacity-50">{busy ? "Obrađujem…" : "Pregledaj uvoz"}</button>
    </form>
    {message && <p role="status" className="mt-3 text-sm font-medium">{message}</p>}
    {preview && <div className="mt-4">
      <p className="text-sm font-semibold">{preview.preview.rows.length} artikala · {preview.preview.rows.filter(row => row.error).length} grešaka</p>
      <div className="mt-2 max-h-72 overflow-auto"><table className="w-full text-left text-sm"><thead><tr>{["Red", "Šifra", "Naziv", "MP cena", "Dosadašnja akcijska", "Nova akcijska", "Provera"].map(label => <th key={label} className="p-2">{label}</th>)}</tr></thead><tbody>{preview.preview.rows.map(row => <tr key={row.row} className="border-t border-border"><td className="p-2">{row.row}</td><td className="p-2">{row.sku}</td><td className="p-2">{row.name}</td><td className="p-2">{row.regularPrice == null ? "—" : formatRsd(row.regularPrice)}</td><td className="p-2">{row.previousPrice == null ? "—" : formatRsd(row.previousPrice)}</td><td className="p-2">{formatRsd(row.salePrice)}</td><td className={`p-2 ${row.error ? "text-action" : "text-success"}`}>{row.error ?? (row.exists ? "Ažuriranje" : "Dodavanje")}</td></tr>)}</tbody></table></div>
      <button type="button" onClick={() => void apply()} disabled={busy || !preview.preview.valid} className="mt-3 rounded-lg bg-ink-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">{busy ? "Primenjujem…" : "Primeni proverene cene"}</button>
      {!preview.preview.valid && <p className="mt-2 text-sm text-action">Ispravite sve greške i ponovite pregled. Nijedna cena nije promenjena.</p>}
    </div>}
  </details>;
}
