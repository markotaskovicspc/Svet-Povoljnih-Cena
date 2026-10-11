"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { previewPurchaseOrderImport, applyPurchaseOrderImportAction } from "@/app/admin/erp/porudzbenice/import-actions";

type Preview = Extract<Awaited<ReturnType<typeof previewPurchaseOrderImport>>, { ok: true }>;
export function PurchaseOrderImport({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function inspect(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget); data.set("orderId", orderId);
    setBusy(true); setMessage(""); setPreview(null);
    try { const result = await previewPurchaseOrderImport(data); if (result.ok) setPreview(result); else setMessage(result.error); }
    catch { setMessage("Pregled nije uspeo. Pokušajte ponovo."); }
    finally { setBusy(false); }
  }
  async function apply() {
    if (!preview || busy) return;
    const data = new FormData(); data.set("orderId", orderId); data.set("rows", JSON.stringify(preview.input)); data.set("fingerprint", preview.preview.fingerprint);
    setBusy(true); setMessage("");
    try {
      const result = await applyPurchaseOrderImportAction({ ok: false, message: "" }, data);
      setMessage(result.message);
      setPreview(null);
      if (result.ok) router.refresh();
    } catch { setPreview(null); setMessage("Primena nije potvrđena. Ponovite pregled da proverite stanje pre novog pokušaja."); }
    finally { setBusy(false); }
  }
  return <details className="mt-4 rounded-xl border border-border bg-surface p-4">
    <summary className="cursor-pointer font-semibold">Uvoz stavki porudžbenice (CSV / XLSX)</summary>
    <p className="mt-3 text-sm text-ink-600">Kolone: Šifra i Količina. Do 500 artikala i 500 KB, prvi list datoteke. Šifre unesite kao tekst da sačuvate početne nule. Najpre sačuvajte dobavljača i datum porudžbenice.</p>
    <p className="mt-2 text-sm text-ink-600">Uvoz dodaje nove stavke. Duplirane šifre i artikli koji već postoje u porudžbenici se odbijaju; postojeće količine izmenite u tabeli. Cene, valuta i paritet preuzimaju se iz važećeg nabavnog cenovnika za datum porudžbenice. Sve stavke se primenjuju zajedno tek nakon pregleda.</p>
    <a download="stavke-porudzbenice.csv" href="/api/admin/purchase-orders/import-template" className="mt-2 inline-block text-sm underline">Preuzmi CSV šablon</a>
    <form onSubmit={inspect} className="mt-3 flex flex-wrap items-center gap-3">
      <input aria-label="Datoteka sa stavkama porudžbenice" name="file" type="file" accept=".csv,.xlsx" required disabled={busy} onChange={() => { setPreview(null); setMessage(""); }} className="max-w-full text-sm" />
      <button type="submit" disabled={busy} className="rounded-lg border border-border px-4 py-2 text-sm disabled:opacity-50">{busy ? "Obrađujem…" : "Pregledaj stavke za uvoz"}</button>
    </form>
    {message && <p role="status" className="mt-3 text-sm font-medium">{message}</p>}
    {preview && <div className="mt-4">
      <p className="text-sm">{preview.preview.orderNumber} · {preview.preview.supplierName} · {preview.preview.orderDate} · {preview.preview.currency}</p>
      <p className="mt-2 text-sm font-semibold">{preview.preview.rows.length} stavki · {preview.preview.rows.filter(row => row.error).length} grešaka</p>
      <div className="mt-2 max-h-80 overflow-auto"><table className="w-full text-left text-sm"><thead><tr>{["Red", "Šifra", "Naziv", "Količina", "Nabavna cena", "Paritet", "Cena važi od", "Provera"].map(label => <th key={label} className="p-2">{label}</th>)}</tr></thead><tbody>{preview.preview.rows.map(row => <tr key={row.row} className="border-t border-border"><td className="p-2">{row.row}</td><td className="p-2">{row.sku}</td><td className="p-2">{row.name}</td><td className="p-2">{row.qty}</td><td className="p-2 whitespace-nowrap">{row.price == null ? "—" : `${row.price.toLocaleString("sr-Latn-RS", { minimumFractionDigits: 2 })} ${row.currency}`}</td><td className="p-2">{row.parity ?? "—"}</td><td className="p-2">{row.priceValidFrom ?? "—"}</td><td className={`p-2 ${row.error ? "text-action" : "text-success"}`}>{row.error ?? "Dodavanje"}</td></tr>)}</tbody></table></div>
      <button type="button" onClick={() => void apply()} disabled={busy || !preview.preview.valid} className="mt-3 rounded-lg bg-ink-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">{busy ? "Primenjujem…" : "Primeni proverene stavke"}</button>
      {!preview.preview.valid && <p className="mt-2 text-sm text-action">Ispravite sve greške i ponovite pregled. Nijedna stavka nije upisana.</p>}
    </div>}
  </details>;
}
