"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { MAX_PRODUCT_LABELS, missingProductLabelFields, PRODUCT_LABELS_PER_SHEET, type ProductLabelArticle } from "@/lib/admin/product-labels";

type Selected = ProductLabelArticle & { copies: number };
const inputClass = "mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm";
const buttonClass = "rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium disabled:opacity-50";

export function ProductLabelPrint({ initialArticle }: { initialArticle?: ProductLabelArticle }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ProductLabelArticle[]>([]);
  const [selected, setSelected] = useState<Selected[]>(initialArticle ? [{ ...initialArticle, copies: 24 }] : []);
  const [startPosition, setStartPosition] = useState(1);
  const [searching, setSearching] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [error, setError] = useState("");
  const [searched, setSearched] = useState(false);
  const [pdfUrl, setPdfUrl] = useState("");
  const activeUrl = useRef("");
  useEffect(() => () => { if (activeUrl.current) URL.revokeObjectURL(activeUrl.current); }, []);
  const total = selected.reduce((sum, article) => sum + article.copies, 0);
  const validCounts = selected.every(article => Number.isInteger(article.copies) && article.copies > 0);
  const missingFields = selected.some(article => missingProductLabelFields(article).length);
  const sheets = total > 0 ? Math.ceil((startPosition - 1 + total) / PRODUCT_LABELS_PER_SHEET) : 0;

  function invalidatePdf() {
    if (activeUrl.current) URL.revokeObjectURL(activeUrl.current);
    activeUrl.current = "";
    setPdfUrl("");
    setError("");
  }

  async function search(event: FormEvent) {
    event.preventDefault();
    setSearching(true); setError(""); setSearched(false); setResults([]);
    try {
      const response = await fetch(`/api/admin/product-labels?q=${encodeURIComponent(query.trim())}`);
      if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) throw new Error("Pretraga nije uspela. Proverite prijavu i pokušajte ponovo.");
      const data = await response.json();
      setResults(data.articles); setSearched(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Pretraga nije uspela."); }
    finally { setSearching(false); }
  }

  async function preparePdf(event: FormEvent) {
    event.preventDefault(); invalidatePdf(); setPrinting(true);
    try {
      const response = await fetch("/api/admin/product-labels", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ items: selected.map(article => ({ productId: article.id, copies: article.copies })), startPosition }),
      });
      if (!response.ok || !response.headers.get("content-type")?.includes("application/pdf")) {
        const data = response.headers.get("content-type")?.includes("application/json") ? await response.json() : null;
        throw new Error(data?.error ?? "PDF nije pripremljen. Proverite prijavu i pokušajte ponovo.");
      }
      activeUrl.current = URL.createObjectURL(await response.blob());
      setPdfUrl(activeUrl.current);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Štampa nije uspela."); }
    finally { setPrinting(false); }
  }

  return <div className="space-y-6">
    <section className="rounded-2xl border border-border bg-surface p-5">
      <h2 className="text-lg font-semibold">Dodajte artikle</h2>
      <form onSubmit={search} className="mt-3 flex flex-wrap items-end gap-3">
        <label className="min-w-52 flex-1 text-sm">Šifra, barkod ili naziv artikla<input className={inputClass} value={query} onChange={event => setQuery(event.target.value)} minLength={2} maxLength={100} required disabled={printing || searching}/></label>
        <button className={buttonClass} disabled={printing || searching || query.trim().length < 2}>{searching ? "Pretražujem…" : "Pronađi artikal"}</button>
      </form>
      {searched && !results.length && <p role="status" className="mt-3 text-sm">Nema artikala za tu pretragu.</p>}
      <div className="mt-3 space-y-2">{results.map(article => <div key={article.id} className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
        <div className="min-w-0"><p className="break-words text-sm font-medium">{article.sku} · {article.name}</p><p className="text-xs text-ink-500">Barkod: {article.barcode || "Nije upisan"}</p></div>
        <button type="button" className={buttonClass} disabled={printing || selected.some(item => item.id === article.id)} onClick={() => { invalidatePdf(); setSelected(current => [...current, { ...article, copies: 24 }]); }}>{selected.some(item => item.id === article.id) ? "Dodat" : "Dodaj"}</button>
      </div>)}</div>
    </section>

    <form onSubmit={preparePdf} className="space-y-4 rounded-2xl border border-border bg-surface p-5">
      <h2 className="text-lg font-semibold">Nalepnice za štampu</h2>
      <p className="text-sm text-ink-500">A4 uspravno · 3 kolone × 8 redova · 24 nalepnice od 70 × 37,125 mm. Štampajte u stvarnoj veličini (100%), bez prilagođavanja stranici.</p>
      {!selected.length && <p className="text-sm">Pronađite i dodajte artikal iznad.</p>}
      <div className="space-y-3">{selected.map(article => {
        const missing = missingProductLabelFields(article);
        return <div key={article.id} className="flex flex-wrap items-start gap-4 rounded-xl border border-border p-3">
          {article.imageUrl && <Image src={article.imageUrl} alt="" width={64} height={64} unoptimized className="h-16 w-16 rounded bg-white object-contain"/>}
          <div className="min-w-40 flex-1"><Link href={`/admin/erp/artikli/${encodeURIComponent(article.id)}`} className="text-sm font-medium underline">{article.sku} · {article.name}</Link>
            <p className="mt-1 text-xs text-ink-500">{article.barcode || "Bez barkoda"} · {article.importer} · {article.countryOfOrigin || "Bez zemlje porekla"}</p>
            {missing.length > 0 && <p className="mt-1 text-sm text-warning">Dopunite artikal pre štampe: {missing.join(", ")}.</p>}
          </div>
          <label className="w-28 text-sm">Broj nalepnica<input type="number" aria-label={`Broj nalepnica za ${article.sku}`} className={inputClass} min={1} max={MAX_PRODUCT_LABELS} step={1} value={article.copies || ""} required disabled={printing} onChange={event => { invalidatePdf(); const copies = Number(event.target.value); setSelected(current => current.map(item => item.id === article.id ? { ...item, copies } : item)); }}/></label>
          <button type="button" className={buttonClass} disabled={printing} aria-label={`Ukloni ${article.sku}`} onClick={() => { invalidatePdf(); setSelected(current => current.filter(item => item.id !== article.id)); }}>Ukloni</button>
        </div>;
      })}</div>
      <label className="block max-w-sm text-sm">Početna pozicija na prvom listu<select className={inputClass} value={startPosition} disabled={printing} onChange={event => { invalidatePdf(); setStartPosition(Number(event.target.value)); }}>{Array.from({ length: 24 }, (_, index) => <option key={index} value={index + 1}>{index + 1} · red {Math.floor(index / 3) + 1}, kolona {index % 3 + 1}</option>)}</select></label>
      <p className="text-sm" role="status">Ukupno: {total} nalepnica · {sheets} A4 {sheets === 1 ? "list" : "listova"}. Redosled je sleva nadesno, odozgo nadole.</p>
      {total > MAX_PRODUCT_LABELS && <p className="text-sm text-warning">Najviše {MAX_PRODUCT_LABELS} nalepnica po štampi.</p>}
      <button className={buttonClass} disabled={printing || searching || !selected.length || !validCounts || missingFields || total > MAX_PRODUCT_LABELS}>{printing ? "Pripremam PDF…" : "Pripremi PDF za štampu"}</button>
      {pdfUrl && <div className="flex flex-wrap gap-4" role="status"><a className="font-medium underline" href={pdfUrl} target="_blank" rel="noopener noreferrer">Otvori PDF za štampu</a><a className="underline" href={pdfUrl} download="nalepnice-za-kutije-a4.pdf">Preuzmi PDF</a></div>}
    </form>
    {error && <p role="alert" className="rounded-xl border border-destructive/30 p-4 text-sm text-destructive">{error}</p>}
  </div>;
}
