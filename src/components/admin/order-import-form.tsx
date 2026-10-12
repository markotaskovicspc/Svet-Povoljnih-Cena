"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ImagePlus, MessageSquareText, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ImportReview } from "@/lib/admin/order-import/schema";
import { CityAutocomplete } from "@/components/forms/city-autocomplete";

type Totals = { subtotal: number; shipping: number; total: number };
const confidenceLabel = { high: "Visoko poklapanje", medium: "Srednje poklapanje", low: "Slabo poklapanje — proverite" };
const money = (n: number) => new Intl.NumberFormat("sr-RS", { style: "currency", currency: "RSD" }).format(n);
const fields = [
  ["firstName", "Ime"], ["lastName", "Prezime"], ["phone", "Telefon"], ["email", "E-pošta (opciono)"],
  ["street", "Ulica"], ["houseNumber", "Kućni broj"], ["city", "Mesto"], ["postalCode", "Poštanski broj"],
] as const;
export function OrderImportForm() {
  const [mode, setMode] = useState<"image" | "text">("image");
  const [file, setFile] = useState<File | null>(null);
  const [imageUrl, setImageUrl] = useState("");
  const [text, setText] = useState("");
  const [draft, setDraft] = useState<ImportReview | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [quote, setQuote] = useState("");
  const [totals, setTotals] = useState<Totals | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [order, setOrder] = useState<{ id: string; number: string } | null>(null);
  useEffect(() => () => { if (imageUrl) URL.revokeObjectURL(imageUrl); }, [imageUrl]);
  function pickImage(next: File) {
    if (next.size > 3000000 || !["image/png", "image/jpeg", "image/webp"].includes(next.type)) { setError("Dodajte PNG, JPG ili WebP screenshot do 3 MB."); return; }
    setFile(next); setImageUrl(URL.createObjectURL(next)); setError("");
  }
  function patch(next: ImportReview) { setDraft(next); setQuote(""); setTotals(null); setConfirmed(false); setError(""); }
  async function request(body: FormData | object) {
    const response = await fetch("/api/admin/erp/order-import", body instanceof FormData
      ? { method: "POST", body }
      : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload) {
      const failure = new Error(payload?.error ?? "Zahtev nije potvrđen. Pokušajte ponovo.") as Error & { status?: number };
      failure.status = response.status; throw failure;
    }
    return payload;
  }
  async function read() {
    setBusy("read"); setError("");
    try { const form = new FormData(); if (mode === "image" && file) form.set("image", file); else form.set("text", text); const result = await request(form); setDraft(result.draft); setQuote(""); setTotals(null); setAttempted(false); }
    catch (e) { setError(e instanceof Error ? e.message : "Čitanje nije uspelo."); }
    finally { setBusy(""); }
  }
  async function search(index: number) {
    if (!draft) return;
    setBusy(`search-${index}`); setError("");
    try { const line = draft.lines[index]; const response = await fetch(`/api/admin/erp/order-import?q=${encodeURIComponent(line.sku || line.name)}`); const result = await response.json(); if (!response.ok) throw new Error(result.error); patch({ ...draft, lines: draft.lines.map((l, i) => i === index ? { ...l, sku: result.products[0]?.sku ?? "", suggested: result.products[0]?.matchKind === "suggested", candidates: result.products } : l) }); }
    catch (e) { setError(e instanceof Error ? e.message : "Pretraga nije uspela."); }
    finally { setBusy(""); }
  }
  async function preview() {
    if (!draft) return;
    setBusy("preview"); setError("");
    try {
      const { firstName, lastName, phone, street, houseNumber, city, postalCode, email, paymentMethod, shippingMethod } = draft;
      const result = await request({ action: "preview", input: {
        shipping: { firstName, lastName, phone, street, houseNumber, city, postalCode, country: "RS", xExpressTownId: draft.xExpressTownId },
        ...(email.trim() ? { guestEmail: email.trim() } : {}), paymentMethod, shippingMethod,
        lines: draft.lines.map(l => ({ sku: l.sku, qty: l.qty })), billingSameAsShipping: true, consent: true,
      } });
      if (result.shipping) setDraft({ ...draft, city: result.shipping.city, postalCode: result.shipping.postalCode, xExpressTownId: result.shipping.xExpressTownId });
      setQuote(result.quote); setTotals(result.totals);
    } catch (e) { setError(e instanceof Error ? e.message : "Proverite podatke."); }
    finally { setBusy(""); }
  }
  async function create() {
    setBusy("create"); setError(""); setAttempted(true);
    try { const result = await request({ action: "create", quote, confirmed }); setOrder(result.order); }
    catch (e) {
      const status = (e as Error & { status?: number }).status;
      if (status && status < 500 && status !== 429) setAttempted(false);
      setError(e instanceof Error ? e.message : "Ishod nije potvrđen. Proverite listu porudžbina ili ponovite isti pokušaj.");
    } finally { setBusy(""); }
  }
  if (order) return <section className="rounded-xl border border-green-600/30 bg-green-500/10 p-6"><h2 className="text-xl font-semibold">Porudžbina {order.number} je kreirana</h2><p className="mt-2 text-sm">Sačuvana je u pregledu porudžbina.</p><div className="mt-5 flex flex-wrap gap-3"><Link className="underline" href={`/admin/erp/prodajni-nalozi/${order.id}`}>Otvori porudžbinu →</Link><Button variant="outline" onClick={() => { setOrder(null); setDraft(null); setFile(null); setImageUrl(""); setText(""); setQuote(""); setTotals(null); setAttempted(false); setConfirmed(false); }}>Nova porudžbina iz chata</Button></div></section>;
  return <div className="mx-auto max-w-4xl space-y-6">
    {!draft ? <section className="rounded-xl border border-border bg-background p-5 md:p-6">
      <div className="grid gap-3 sm:grid-cols-2">
        <button type="button" aria-pressed={mode === "image"} disabled={!!busy} onClick={() => { setMode("image"); setError(""); }} className={`flex items-center gap-3 rounded-xl border p-5 text-left ${mode === "image" ? "border-primary bg-primary/10" : "border-border"}`}><ImagePlus className="size-6 shrink-0" /><span className="font-semibold">Dodaj sliku za porudžbinu</span></button>
        <button type="button" aria-pressed={mode === "text"} disabled={!!busy} onClick={() => { setMode("text"); setError(""); }} className={`flex items-center gap-3 rounded-xl border p-5 text-left ${mode === "text" ? "border-primary bg-primary/10" : "border-border"}`}><MessageSquareText className="size-6 shrink-0" /><span className="font-semibold">Nalepi ceo chat</span></button>
      </div>
      {mode === "image" ? <div className="mt-5 rounded-lg border border-dashed border-border p-5" tabIndex={0} onPaste={e => { const image = Array.from(e.clipboardData.files).find(f => f.type.startsWith("image/")); if (image) { e.preventDefault(); pickImage(image); } }}>
        <label className="block font-medium" htmlFor="order-image">Izaberi screenshot ili ga nalepi ovde</label><p className="mt-1 text-sm text-muted-foreground">PNG, JPG ili WebP, do 3 MB. Jedna porudžbina po slici.</p>
        <input id="order-image" className="mt-4 block w-full text-sm" type="file" accept="image/png,image/jpeg,image/webp" disabled={!!busy} onChange={e => { if (e.target.files?.[0]) pickImage(e.target.files[0]); }} />
        {imageUrl && <img src={imageUrl} alt="Izabrani screenshot porudžbine" className="mt-4 max-h-80 max-w-full rounded-lg object-contain" />}
      </div> : <div className="mt-5"><label htmlFor="order-chat" className="block font-medium">Cela prepiska za jednu porudžbinu</label><textarea id="order-chat" className="mt-2 min-h-64 w-full rounded-lg border border-border bg-background p-3 text-base" value={text} maxLength={30000} disabled={!!busy} onChange={e => setText(e.target.value)} placeholder="Nalepite poruke kupca i dogovor o artiklima, adresi, telefonu i plaćanju…" /></div>}
      <Button className="mt-5 w-full sm:w-auto" disabled={!!busy || (mode === "image" ? !file : !text.trim())} onClick={read}>{busy === "read" ? "GPT čita porudžbinu…" : "Pročitaj porudžbinu"}</Button>
    </section> : <>
      <section className="rounded-xl border border-border bg-background p-5 md:p-6"><div className="flex items-center justify-between gap-3"><h2 className="text-xl font-semibold">Proveri podatke kupca</h2><Button variant="outline" disabled={!!busy || attempted} onClick={() => { setDraft(null); setQuote(""); setTotals(null); }}>Promeni izvor</Button></div>
        {!!draft.warnings.length && <ul className="mt-4 space-y-1 rounded-lg bg-amber-500/10 p-4 text-sm">{draft.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
        <div className="mt-5 grid gap-4 sm:grid-cols-2">{fields.filter(([key]) => key !== "city" || draft.shippingMethod !== "KURIR").map(([key, label]) => <label key={key} className="text-sm font-medium">{label}{!draft[key].trim() && key !== "email" && <span className="ml-2 text-destructive">Nedostaje</span>}<Input className={`mt-1 ${!draft[key].trim() && key !== "email" ? "border-destructive/50" : ""}`} type={key === "email" ? "email" : key === "phone" ? "tel" : "text"} disabled={!!busy || attempted} value={draft[key]} onChange={e => patch({ ...draft, [key]: e.target.value, ...(key === "city" || key === "postalCode" ? { xExpressTownId: null } : {}) })} /></label>)}{draft.shippingMethod === "KURIR" && <fieldset disabled={!!busy || attempted} className="min-w-0"><CityAutocomplete label="Mesto" required strictRemote autoResolveExact minChars={2} value={draft.city} postalCode={draft.postalCode} selectedTownId={draft.xExpressTownId} onValueChange={city => patch({ ...draft, city, xExpressTownId: null })} onSelect={place => patch({ ...draft, city: place.name, postalCode: place.postalCode, xExpressTownId: place.townId ?? null })} /><p className="mt-1 text-xs text-muted-foreground">Mesto i poštanski broj prepoznajemo automatski. Proverite ih; ako ima više mogućnosti, izaberite mesto iz liste.</p></fieldset>}</div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2"><label className="text-sm font-medium">Plaćanje<select className="mt-1 h-11 w-full rounded-lg border border-border bg-background px-3" disabled={!!busy || attempted} value={draft.paymentMethod} onChange={e => patch({ ...draft, paymentMethod: e.target.value as ImportReview["paymentMethod"] })}><option value="">Izaberi plaćanje</option><option value="POUZECE_GOTOVINA">Pouzeće — gotovina</option><option value="POUZECE_KARTICA">Pouzeće — kartica</option><option value="UPLATA_NA_RACUN">Uplata na račun</option></select></label>
        <label className="text-sm font-medium">Dostava<select className="mt-1 h-11 w-full rounded-lg border border-border bg-background px-3" disabled={!!busy || attempted} value={draft.shippingMethod} onChange={e => patch({ ...draft, shippingMethod: e.target.value as ImportReview["shippingMethod"] })}><option value="">Izaberi dostavu</option><option value="KURIR">Kurir</option><option value="KAMION">Kamion</option></select></label></div>
      </section>
      <section className="rounded-xl border border-border bg-background p-5 md:p-6"><h2 className="text-xl font-semibold">Artikli</h2><p className="mt-1 text-sm text-muted-foreground">Najverovatniji artikal je predložen prvi. Lista je sortirana po poklapanju — proverite model, boju i veličinu. Cena i dostava računaju se prema važećim pravilima.</p>
        <div className="mt-4 space-y-4">{draft.lines.map((line, index) => <div key={index} className="rounded-lg border border-border p-4"><p className="font-medium">{line.name || "Artikal nije prepoznat"}</p><p role="status" className={`mt-1 text-sm ${line.sku && !line.suggested ? "text-green-600 dark:text-green-400" : "text-amber-700 dark:text-amber-400"}`}>{line.sku ? `${line.suggested ? "Predložen artikal — proverite" : "Povezan sa katalogom"}: ${line.candidates.find(p => p.sku === line.sku)?.name ?? line.sku}${line.candidates.find(p => p.sku === line.sku)?.variantLabel ? ` · ${line.candidates.find(p => p.sku === line.sku)?.variantLabel}` : ""} · ${line.sku}` : "Naziv je pročitan, ali nema dovoljno podataka za predlog. Pretražite naziv ili šifru."}</p>{line.sku && line.candidates.find(p => p.sku === line.sku)?.confidence && <p className="mt-1 text-sm text-muted-foreground">{confidenceLabel[line.candidates.find(p => p.sku === line.sku)!.confidence!]} · {line.candidates.find(p => p.sku === line.sku)?.reason}</p>}{line.unitPrice !== null && <p className="text-sm text-muted-foreground">Cena pročitana iz prepiske: {money(line.unitPrice)}</p>}
          <div className="mt-3 flex flex-col gap-2 sm:flex-row"><Input aria-label={`Naziv ili šifra artikla ${index + 1}`} placeholder="Naziv ili šifra za pretragu" value={line.sku || line.name} disabled={!!busy || attempted} onChange={e => patch({ ...draft, lines: draft.lines.map((l, i) => i === index ? { ...l, name: e.target.value, sku: "", candidates: [] } : l) })} /><Button variant="outline" disabled={!!busy || attempted} onClick={() => search(index)}>Pretraži</Button></div>
          <div className="mt-3 flex flex-wrap items-end gap-3"><label className="min-w-0 flex-1 text-sm">Artikal iz kataloga{!line.sku && <span className="ml-2 text-destructive">Izaberi artikal</span>}<select aria-label={`Artikal iz kataloga ${index + 1}`} className={`mt-1 h-11 w-full min-w-0 rounded-lg border bg-background px-2 ${line.sku ? "border-border" : "border-destructive/50"}`} value={line.sku} disabled={!!busy || attempted} onChange={e => patch({ ...draft, lines: draft.lines.map((l, i) => i === index ? { ...l, sku: e.target.value, suggested: false } : l) })}><option value="">Izaberi tačan artikal</option>{line.candidates.map((p, rank) => <option key={p.sku} value={p.sku}>{rank + 1}. {p.name}{p.variantLabel ? ` · ${p.variantLabel}` : ""} · {p.sku}{p.confidence ? ` — ${confidenceLabel[p.confidence]}` : ""}</option>)}</select></label>
          <label className="w-24 text-sm">Količina<Input aria-label={`Količina ${index + 1}`} className="mt-1" type="number" min={1} max={99} value={line.qty ?? ""} disabled={!!busy || attempted} onChange={e => patch({ ...draft, lines: draft.lines.map((l, i) => i === index ? { ...l, qty: e.target.value ? Number(e.target.value) : null } : l) })} /></label><Button variant="outline" aria-label={`Ukloni artikal ${index + 1}`} disabled={!!busy || attempted} onClick={() => patch({ ...draft, lines: draft.lines.filter((_, i) => i !== index) })}><Trash2 className="size-4" /></Button></div>
        </div>)}</div>
        <Button variant="outline" className="mt-4 gap-2" disabled={!!busy || attempted || draft.lines.length >= 50} onClick={() => patch({ ...draft, lines: [...draft.lines, { name: "", sku: "", qty: null, unitPrice: null, candidates: [] }] })}><Plus className="size-4" />Dodaj artikal</Button>
      </section>
      <section className="rounded-xl border border-border bg-background p-5 md:p-6">
        {!quote ? <Button className="w-full sm:w-auto" disabled={!!busy || !draft.lines.length || draft.lines.some(l => !l.sku || !l.qty)} onClick={preview}>{busy === "preview" ? "Proveravam cene i dostavu…" : "Proveri iznose i dostavu"}</Button> : totals && <>
          <div className="space-y-2 text-sm"><p className="flex justify-between gap-3"><span>Artikli (sa popustima)</span><strong>{money(totals.subtotal)}</strong></p><p className="flex justify-between gap-3"><span>Dostava</span><strong>{money(totals.shipping)}</strong></p><p className="flex justify-between gap-3 border-t border-border pt-3 text-lg"><span>Ukupno</span><strong>{money(totals.total)}</strong></p></div>
          {draft.totalAmount !== null && Math.abs(draft.totalAmount - totals.total) > 0.01 && <p className="mt-4 rounded-lg bg-amber-500/10 p-3 text-sm">U prepisci je navedeno {money(draft.totalAmount)}. Obračun u ERP-u je drugačiji — proverite dogovor pre kreiranja.</p>}
          <label className="mt-5 flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1 size-4 shrink-0" checked={confirmed} disabled={!!busy || attempted} onChange={e => setConfirmed(e.target.checked)} />Proverio sam podatke, izabrane artikle i iznose. Kupac je potvrdio ovu porudžbinu.</label>
          <Button className="mt-5 w-full sm:w-auto" disabled={!!busy || !confirmed} onClick={create}>{busy === "create" ? "Kreiram porudžbinu…" : attempted ? "Ponovi isti pokušaj kreiranja" : "Kreiraj porudžbinu"}</Button>
          {attempted && <Link className="ml-3 inline-block text-sm underline" href="/admin/erp/prodajni-nalozi" target="_blank">Proveri listu porudžbina</Link>}
        </>}
      </section>
    </>}
    {error && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm">{error}</p>}
  </div>;
}
