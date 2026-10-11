"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { PurchasePriceImportRow } from "@/lib/admin/purchase-price-import";

type PreviewRow = PurchasePriceImportRow & { name: string; supplierName: string; resolvedCurrency: string; effectiveValidTo: string; closesPrevious: boolean };
type Preview = { rows: PreviewRow[]; valid: boolean; token: string | null };
const endpoint = "/api/admin/erp/nabavne-cene/import";

export function PurchasePriceImport() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function run(action: "preview" | "apply") {
    if (!file || busy) return;
    setBusy(true); setError(""); setSuccess("");
    const form = new FormData(); form.set("file", file); form.set("action", action);
    if (action === "apply" && preview?.token) form.set("token", preview.token);
    try {
      const response = await fetch(endpoint, { method: "POST", body: form });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error ?? "Uvoz nije uspeo.");
      if (action === "preview") setPreview(data);
      else { setPreview(null); setSuccess(`Uspešno je uvezeno ${data.count} nabavnih cena.`); setFile(null); }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Uvoz nije uspeo.");
      setPreview(null);
    } finally { setBusy(false); }
  }

  return <div className="space-y-6">
    <section className="space-y-4 rounded-xl border border-border bg-background p-5">
      <h2 className="text-lg font-semibold">1. Izaberite datoteku</h2>
      <p className="text-sm text-muted-foreground">Do 500 redova i 2 MB. Obavezne kolone: Šifra, Nabavna cena, Važenje od. Opcione: Važenje do, Valuta, Dobavljač. XLSX treba da ima jedan radni list, bez formula.</p>
      <p className="text-sm text-muted-foreground">Cene: 1234,56 ili 1.234,56 ili 1234.56. Datumi: 2026-10-11 ili 11.10.2026. Dobavljač (šifra ili naziv), valuta i paritet preuzimaju se iz baze artikala. Ako ih unesete u datoteku, moraju odgovarati bazi.</p>
      <p className="text-sm text-muted-foreground">Uvoz dodaje nove datume cena. Postojeća cena sa istim datumom se ne prepisuje. Prethodni period se po potrebi zatvara dan pre novog, a novi period se završava pre sledeće cene. Prodajne cene se ne menjaju.</p>
      <a href={endpoint} className="inline-block text-sm font-medium underline underline-offset-4">Preuzmi CSV šablon</a>
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid max-w-full gap-2 text-sm font-medium">Datoteka sa nabavnim cenama
          <input key={success || "upload"} type="file" accept=".csv,.xlsx" disabled={busy} className="max-w-full rounded-lg border border-border p-2" onChange={event => { setFile(event.target.files?.[0] ?? null); setPreview(null); setError(""); setSuccess(""); }} />
        </label>
        <Button disabled={!file || busy} onClick={() => run("preview")}>{busy ? "Obrada…" : "Pregledaj uvoz"}</Button>
      </div>
    </section>
    {error && <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-700 dark:text-red-300">{error}</p>}
    {success && <div role="status" className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4"><p>{success}</p><Link href="/admin/erp/nabavne-cene" className="mt-2 inline-block underline">Otvori nabavne cene</Link></div>}
    {preview && <section className="space-y-4 rounded-xl border border-border bg-background p-5">
      <h2 className="text-lg font-semibold">2. Proverite i potvrdite uvoz</h2>
      <p role="status" className="text-sm">{preview.valid ? `${preview.rows.length} ispravnih redova. Nijedna cena još nije upisana.` : `${preview.rows.filter(row => row.errors.length).length} redova sa greškama. Ispravite datoteku i ponovite pregled. Nijedna cena nije upisana.`}</p>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-left text-sm"><caption className="sr-only">Pregled nabavnih cena pre uvoza</caption>
          <thead className="bg-muted"><tr>{["Red", "Šifra / artikal", "Dobavljač", "Cena", "Važenje od", "Važenje do", "Provera"].map(label => <th key={label} className="whitespace-nowrap p-3">{label}</th>)}</tr></thead>
          <tbody>{preview.rows.map(row => <tr key={row.row} className="border-t border-border"><td className="p-3">{row.row}</td><td className="p-3"><span className="font-medium">{row.sku}</span><span className="block text-xs text-muted-foreground">{row.name}</span></td><td className="p-3">{row.supplierName}</td><td className="whitespace-nowrap p-3">{row.purchasePrice} {row.resolvedCurrency}</td><td className="whitespace-nowrap p-3">{row.validFrom}</td><td className="whitespace-nowrap p-3">{row.effectiveValidTo || "Bez kraja"}</td><td className="min-w-48 p-3">{row.errors.length ? <ul className="space-y-1 text-red-700 dark:text-red-300">{row.errors.map((message, index) => <li key={index}>{message}</li>)}</ul> : <span>{row.closesPrevious ? "Ispravno; zatvara prethodni period" : "Ispravno"}</span>}</td></tr>)}</tbody>
        </table>
      </div>
      <p className="text-sm text-muted-foreground">Potvrda važi 15 minuta. Sve cene se upisuju zajedno tek nakon ponovne provere. Ako se podaci u međuvremenu promene, potreban je novi pregled.</p>
      <Button disabled={!preview.valid || !preview.token || busy} onClick={() => run("apply")}>{busy ? "Obrada…" : `Potvrdi uvoz (${preview.rows.length})`}</Button>
    </section>}
  </div>;
}
