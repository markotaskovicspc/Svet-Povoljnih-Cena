"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveProductSet } from "./actions";
import { formatRsd as formatMoney } from "@/lib/format";
const formatRsd = (value: number) => formatMoney(value, true);

type SetEditorValue = { id: string; name: string; slug: string; description: string; active: boolean; version: string; price: number; components: Array<{ sku: string; name: string; quantity: number; unitPrice: number }> };
const field = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm";
export function ProductSetForm({ value }: { value?: SetEditorValue }) {
  const router = useRouter();
  const [rows, setRows] = useState(value?.components.map(c => ({ sku: c.sku, quantity: c.quantity })) ?? [{ sku: "", quantity: 1 }, { sku: "", quantity: 1 }]);
  const [message, setMessage] = useState("");
  const [ok, setOk] = useState(false);
  const [pending, start] = useTransition();
  return <form className="space-y-5 rounded-2xl border border-border bg-background p-5" onSubmit={e => {
    e.preventDefault(); const form = new FormData(e.currentTarget);
    start(async () => {
      const result = await saveProductSet({ id: value?.id, version: value?.version, name: form.get("name"), slug: form.get("slug"), description: form.get("description"), price: Number(String(form.get("price")).replace(",", ".")), active: form.get("active") === "on", components: rows });
      setMessage(result.message); setOk(result.ok);
      if (result.ok && result.result) { router.replace(`/admin/erp/setovi?id=${result.result.id}`); router.refresh(); }
    });
  }}>
    <h2 className="text-lg font-semibold">{value ? "Izmena seta" : "Novi prodajni set"}</h2>
    <div className="grid gap-4 sm:grid-cols-2">
      <label className="space-y-1 text-sm">Naziv seta<input className={field} name="name" defaultValue={value?.name} required maxLength={160} /></label>
      <label className="space-y-1 text-sm">Adresa (npr. trpezarijski-set)<input className={field} name="slug" defaultValue={value?.slug} required pattern="[a-z0-9]+(-[a-z0-9]+)*" /></label>
    </div>
    <label className="block space-y-1 text-sm">Opis seta<textarea className={field} name="description" rows={3} defaultValue={value?.description} maxLength={5000} /></label>
    <fieldset className="space-y-3"><legend className="mb-2 font-medium">Sastav seta</legend>
      <p className="text-sm text-muted-foreground">Unesite postojeće šifre artikala i broj komada u jednom setu. Set može sadržati 2–20 različitih artikala.</p>
      {rows.map((row, i) => <div className="grid grid-cols-[1fr_100px_auto] items-end gap-2" key={i}>
        <label className="text-sm">Šifra artikla {i + 1}<input aria-label={`Šifra artikla ${i + 1}`} className={field} value={row.sku} required onChange={e => setRows(rows.map((r, j) => j === i ? { ...r, sku: e.target.value } : r))} /></label>
        <label className="text-sm">Komada<input aria-label={`Količina ${i + 1}`} className={field} type="number" min={1} max={99} step={1} value={row.quantity} required onChange={e => setRows(rows.map((r, j) => j === i ? { ...r, quantity: Number(e.target.value) } : r))} /></label>
        <button type="button" className="rounded-lg border px-3 py-2 text-sm disabled:opacity-40" disabled={rows.length <= 2} onClick={() => setRows(rows.filter((_, j) => j !== i))} aria-label={`Ukloni komponentu ${i + 1}`}>Ukloni</button>
      </div>)}
      <button type="button" disabled={rows.length >= 20} onClick={() => setRows([...rows, { sku: "", quantity: 1 }])} className="rounded-lg border px-3 py-2 text-sm">Dodaj komponentu</button>
    </fieldset>
    <label className="block max-w-sm space-y-1 text-sm">Zajednička prodajna cena seta (RSD, sa PDV)<input name="price" className={field} type="number" min="0.01" max="10000000" step="0.01" defaultValue={value?.price} required /></label>
    <p className="text-sm text-muted-foreground">Cena se automatski raspoređuje na komponente radi računa i isporuke. Zaliha seta zavisi od najmanje raspoložive komponente; porudžbina rezerviše stvarne artikle. Pojedinačne akcije i loyalty cene artikala ne menjaju zadatu cenu seta.</p>
    {value && <details className="text-sm"><summary className="cursor-pointer">Sačuvana raspodela cene</summary><ul className="mt-2 space-y-1">{value.components.map(c => <li key={c.sku}>{c.quantity} × {c.name} ({c.sku}): {formatRsd(c.unitPrice)} po komadu</li>)}</ul></details>}
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={value?.active} />Objavi set na sajtu</label>
    {message && <p role="status" className={ok ? "text-sm text-green-700" : "text-sm text-red-600"}>{message}</p>}
    <button type="submit" disabled={pending} className="rounded-lg bg-foreground px-5 py-2.5 text-sm font-medium text-background disabled:opacity-50">{pending ? "Čuvanje…" : "Sačuvaj set"}</button>
  </form>;
}
