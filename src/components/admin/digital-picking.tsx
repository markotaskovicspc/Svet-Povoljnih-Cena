"use client";
import { formatPickingVolume } from "@/lib/admin/picking-volume";
import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { LabelPdfActions } from "./label-pdf-actions";
import { PickingCamera } from "./picking-camera";
import type { getPickingSession } from "@/lib/admin/picking.server";
import { recordPicking, finishPicking } from "@/app/admin/erp/preuzimanja/[id]/picking/actions";
import { pickingReview } from "@/lib/admin/picking-review";
type Session = Awaited<ReturnType<typeof getPickingSession>>;
type ScanRequest = Parameters<typeof recordPicking>[0];

export function DigitalPicking({ initial, warehouseMode = false }: { initial: Session; warehouseMode?: boolean }) {
  const [session, setSession] = useState(initial);
  const [code, setCode] = useState("");
  const [camera, setCamera] = useState(false);
  const [cameraStarted, setCameraStarted] = useState(false);
  const cameraButton = useRef<HTMLButtonElement>(null);
  const validCameraScan = useRef(false);
  const [packagesConfirmed, setPackagesConfirmed] = useState(false);
  const [labelUrl, setLabelUrl] = useState<string | null>(initial.labelsReady ? `/api/admin/erp/preuzimanja/${encodeURIComponent(initial.id)}/labels` : null);
  const [shortageReported, setShortageReported] = useState(false);
  const [message, setMessage] = useState("");
  const [scanError, setScanError] = useState(false);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [retry, setRetry] = useState<ScanRequest | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const quantityInput = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState(warehouseMode ? initial.rows.find(row => (initial.progress[row.key] ?? 0) < row.quantity)?.key ?? initial.rows[0]?.key ?? "" : "");
  const [quantity, setQuantity] = useState(warehouseMode ? String(Math.max(0, (initial.rows.find(row => row.key === selected)?.quantity ?? 0) - (initial.progress[selected] ?? 0))) : "1");
  const [note, setNote] = useState("");
  const [noteKey, setNoteKey] = useState("");
  useEffect(() => { if (!warehouseMode && !busy && !retry) input.current?.focus(); }, [busy, retry, warehouseMode]);
  const total = session.rows.reduce((sum, r) => sum + r.quantity, 0);
  const done = session.rows.reduce((sum, r) => sum + (session.progress[r.key] ?? 0), 0);
  const editable = session.editable && !busy && !retry;
  // Keep outstanding work first, and completed items in confirmation order at the end.
  const lastConfirmation = new Map<string, number>();
  if (warehouseMode) session.events.forEach((event, index) => {
    if (event.planHash === session.planHash && event.delta > 0 && !lastConfirmation.has(event.rowKey)) lastConfirmation.set(event.rowKey, index);
  });
  const orderedRows = warehouseMode ? [...session.rows].sort((a, b) => {
    const aDone = (session.progress[a.key] ?? 0) >= a.quantity;
    const bDone = (session.progress[b.key] ?? 0) >= b.quantity;
    if (aDone !== bDone) return Number(aDone) - Number(bDone);
    return aDone ? (lastConfirmation.get(b.key) ?? session.events.length) - (lastConfirmation.get(a.key) ?? session.events.length) : 0;
  }) : session.rows;
  const currentIndex = Math.max(0, orderedRows.findIndex(row => row.key === selected));
  const currentRow = orderedRows[currentIndex];
  const remainingQuantity = currentRow ? Math.max(0, currentRow.quantity - (session.progress[currentRow.key] ?? 0)) : 0;
  const review = pickingReview(session);
  const visibleRows = warehouseMode ? (currentRow ? [currentRow] : []) : session.rows;
  const canScan = editable && (!warehouseMode || Boolean(currentRow && (session.progress[currentRow.key] ?? 0) < currentRow.quantity));
  function moveTo(index: number) {
    const row = orderedRows[index];
    if (!row || busy || retry) return;
    setSelected(row.key); setCode(""); setQuantity(warehouseMode ? String(Math.max(0, row.quantity - (session.progress[row.key] ?? 0))) : "1"); setNote(""); setMessage(""); setScanError(false);
  }
  async function send(request: ScanRequest) {
    if (lock.current) return;
    lock.current = true; setBusy(true);
    try {
      const response = await recordPicking(request);
      if (response.ok && response.result) {
        setSession(response.result); setScanError(false); setRetry(null); setCode(""); setNote(""); setShortageReported(false);
        if (!warehouseMode) setQuantity("1");
        if (warehouseMode) {
          const updated = response.result;
          const row = updated.rows.find(row => row.key === request.rowKey);
          if (row) {
            const start = updated.rows.findIndex(candidate => candidate.key === row.key) + 1;
            const remaining = [...updated.rows.slice(start), ...updated.rows.slice(0, start)].find(candidate => (updated.progress[candidate.key] ?? 0) < candidate.quantity && !updated.reviewedRows.includes(candidate.key));
            if (remaining) { setSelected(remaining.key); setQuantity(String(Math.max(0, remaining.quantity - (updated.progress[remaining.key] ?? 0)))); }
            else { setQuantity(String(Math.max(0, row.quantity - (updated.progress[row.key] ?? 0)))); setCamera(false); setCameraStarted(false); }
          }
        }
        setMessage(response.message);
      } else { setMessage(response.message); setRetry(request); if (warehouseMode) setScanError(true); }
    } catch { if (warehouseMode) setScanError(true); setRetry(request); setMessage("Potvrda nije stigla. Proverite vezu pa ponovite isti zahtev — neće biti duplog evidentiranja."); }
    finally { lock.current = false; setBusy(false); }
  }
  function record(key: string, delta: number, text = "") {
    if (!editable) return;
    void send({ id: crypto.randomUUID(), batchId: session.id, planHash: session.planHash, rowKey: key, delta, note: text });
  }
  function scan() {
    const value = code.trim();
    if (!value || !canScan) return;
    if (warehouseMode && currentRow && currentRow.barcode !== value && currentRow.sku !== value) {
      setScanError(true);
      setMessage("Šifra ne odgovara prikazanom artiklu. Proverite barkod ili otvorite drugi artikal.");
      return;
    }
    const matches = session.rows.filter(r => (r.barcode === value || r.sku === value) && (session.progress[r.key] ?? 0) < r.quantity);
    const row = warehouseMode ? matches.find(r => r.key === currentRow?.key) : matches.length === 1 ? matches[0] : matches.find(r => r.key === selected);
    if (!row) { setMessage(matches.length ? "Ista šifra je u više magacina. Izaberite odgovarajući red pa ponovite sken." : "Šifra nije na ovom nalogu ili je sva količina već odvojena."); return; }
    const amount = Number(quantity);
    if (!quantity.trim() || !Number.isSafeInteger(amount) || amount < (warehouseMode ? 0 : 1) || (warehouseMode && amount > remainingQuantity)) { setMessage(warehouseMode ? "Unesite celu količinu od 0 do preostale tražene količine." : "Unesite pozitivnu celu količinu."); quantityInput.current?.focus(); return; }
    setScanError(false);
    record(row.key, amount, warehouseMode ? `Potvrđena količina: ${amount} kom. Nedostaje ${row.quantity - (session.progress[row.key] ?? 0) - amount} kom. za ${row.sku}.` : "");
  }
  function changeCode(value: string) {
    setCode(value);
    if (warehouseMode && scanError && (!value.trim() || value.trim() === currentRow?.barcode || value.trim() === currentRow?.sku)) {
      setScanError(false); setMessage("");
    }
  }
  function cameraCode(value: string) {
    setCode(warehouseMode ? value.trim() : value);
    if (warehouseMode && currentRow && value.trim() !== currentRow.barcode && value.trim() !== currentRow.sku) {
      setScanError(true);
      setMessage("Šifra ne odgovara prikazanom artiklu. Proverite barkod ili otvorite drugi artikal.");
      return false;
    } else {
      if (warehouseMode) {
        validCameraScan.current = true;
        flushSync(() => { setCamera(false); setCameraStarted(false); setQuantity(String(remainingQuantity)); setScanError(false); setMessage(`Očitano: ${value}. Proverite količinu i kliknite Evidentiraj.`); });
        quantityInput.current?.focus();
      } else {
        setScanError(false); setMessage(`Očitano: ${value}. Proverite količinu i kliknite Evidentiraj.`);
      }
      return true;
    }
  }
  function closeCamera() {
    validCameraScan.current = false;
    setCamera(false); setCameraStarted(false);
  }
  function toggleCamera() {
    if (warehouseMode) { input.current?.blur(); quantityInput.current?.blur(); }
    if (camera) { closeCamera(); return; }
    validCameraScan.current = false;
    setScanError(false); setMessage(""); setCameraStarted(true); setCamera(true);
  }
  async function finish(mode: "labels" | "shortage") {
    if (lock.current) return;
    lock.current = true; setBusy(true);
    try {
      const response = await finishPicking({ batchId: session.id, planHash: session.planHash, mode, packagesConfirmed: packagesConfirmed || Boolean(labelUrl) });
      setMessage(response.message);
      if (response.ok) {
        if (mode === "labels") { setLabelUrl(response.result?.labelUrl ?? null); setSession(previous => ({ ...previous, editable: false, labelsReady: true })); }
        else setShortageReported(true);
      }
    } catch { setMessage("Potvrda nije stigla. Osvežite nalog pre ponovnog pokušaja."); }
    finally { lock.current = false; setBusy(false); }
  }
  const articles = (<div className="space-y-3">
      {warehouseMode && currentRow && <div className="flex items-center justify-between gap-2" aria-label="Kretanje kroz artikle">
        <button type="button" disabled={busy || !!retry || currentIndex === 0} onClick={() => moveTo(currentIndex - 1)} className="rounded-lg border px-3 py-2">← Prethodni</button>
        <p className="text-sm tabular-nums">Artikal {currentIndex + 1} / {session.rows.length}</p>
        <button type="button" disabled={busy || !!retry || currentIndex === session.rows.length - 1} onClick={() => moveTo(currentIndex + 1)} className="rounded-lg border px-3 py-2">Sledeći →</button>
      </div>}{visibleRows.map(row => {
      const count = session.progress[row.key] ?? 0;
      const partiallyPicked = count > 0 && count < row.quantity;
      return <article data-picking-row={row.key} key={row.key} className={`break-inside-avoid rounded-xl border p-4 ${count === row.quantity ? "border-emerald-300 bg-emerald-50 text-emerald-950" : partiallyPicked ? "border-amber-400 bg-amber-50 text-amber-950" : ""} ${!warehouseMode && selected === row.key ? "ring-2 ring-blue-500" : ""}`}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 flex-1 gap-4"><div className="min-w-16 text-center"><span className="text-xs">POZICIJA</span><div className="text-2xl font-bold">{row.positions.join(", ") || "—"}</div></div><div className="min-w-0 break-words"><h2 className="font-semibold">{row.sku} · {row.name}</h2><p className="text-sm">{row.warehouseName} · Barkod: {row.barcode || "Nije upisan"}</p>{!warehouseMode && <p className="mt-2 text-sm">{row.allocations.map(a => `${a.orderNumber}: ${a.quantity} kom.`).join(" · ")}</p>}</div></div>
          {warehouseMode ? <div className="text-right"><strong className="text-xl">{count} / {row.quantity}</strong>{count === row.quantity && <p className="mt-1 text-sm font-semibold">✓ Odvojeno</p>}</div> : <strong className="text-xl">{count} / {row.quantity}</strong>}
        </div>
        {partiallyPicked && <p className="mt-2 text-xs font-semibold">Delimično odvojeno</p>}
        {session.editable && !warehouseMode && <div className="mt-3 flex flex-wrap gap-2 print:hidden">{!warehouseMode && <><button disabled={!editable} onClick={() => setSelected(row.key)} className="rounded border px-3 py-2">{selected === row.key ? "Izabran red" : "Izaberi za sken"}</button><button disabled={!editable || count >= row.quantity} onClick={() => record(row.key, 1, "Ručna potvrda odvajanja")} className="rounded border px-4 py-2">+1</button><button disabled={!editable || count === 0} onClick={() => record(row.key, -1, "Ispravka količine")} className="rounded border px-4 py-2">−1</button></>}<button disabled={!editable} onClick={() => { setSelected(row.key); setNoteKey(row.key); setNote(`Nedostaje ${row.quantity - count} kom. za ${row.sku}. `); }} className="rounded border px-3 py-2">Nedostaje / napomena</button></div>}
      </article>;
    })}</div>);
  return <div data-warehouse-scan-error={warehouseMode ? scanError : undefined} className={`space-y-5 p-4 md:p-8 ${warehouseMode && scanError ? "rounded-xl border-2 border-red-500 bg-red-50 text-red-800 [&_article]:border-red-500 [&_section]:border-red-500 [&_input]:border-red-500" : ""}`}>
    {warehouseMode ? <div className="flex min-w-0 flex-wrap items-center justify-between gap-2" data-warehouse-picking-heading>
      <h1 className="min-w-0 flex-1 break-words text-lg font-semibold">{session.number}</h1>
      <strong className="shrink-0 whitespace-nowrap text-base tabular-nums" aria-label={`Odvojeno ${done} od ${total} komada`}>{done} / {total} kom.</strong>
      <button type="button" aria-label="Osveži picking" title="Osveži" disabled={busy || !!retry} onClick={() => window.location.reload()} className="flex min-w-11 shrink-0 items-center justify-center rounded-lg border p-2 disabled:opacity-50"><RefreshCw size={18} aria-hidden /></button>
    </div> : <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4">
      <div><strong className="text-2xl">{done} / {total} kom.</strong><p>{total > 0 && done === total ? warehouseMode ? "Odvajanje je završeno." : "Roba je odvojena. Nastavite sa proverom pakovanja i dimenzija." : "Odvojeno / potrebno"}</p></div>
      <div className="flex gap-2 print:hidden">{!warehouseMode && <><Link href="/admin/erp/picking-pozicije" className="rounded border px-3 py-2">Pozicije</Link><button onClick={() => window.print()} className="rounded border px-3 py-2">Štampaj putanju</button></>}<button disabled={busy || !!retry} onClick={() => { window.location.reload(); }} className="rounded border px-3 py-2">Osveži</button></div>
    </div>}
    {session.volume && <p className="text-sm font-semibold">Ukupna zapremina: {formatPickingVolume(session.volume)}</p>}
    {warehouseMode && total > 0 && done === total && <p className="text-sm font-semibold text-success">Odvajanje je završeno.</p>}
    {warehouseMode && (review.complete || review.reviewed || labelUrl) && <section className="space-y-3 rounded-xl border bg-muted/20 p-4 print:hidden">
      {review.complete && !labelUrl && <>
        <label className="flex items-center gap-3"><input type="checkbox" checked={packagesConfirmed} disabled={busy || !!retry || !session.labelsPreparationAllowed} onChange={event => setPackagesConfirmed(event.target.checked)} className="size-5" />Potvrđujem da su svi paketi spakovani i da su mere na nalogu tačne.</label>
        <button type="button" disabled={busy || !!retry || !session.labelsPreparationAllowed || !packagesConfirmed} onClick={() => void finish("labels")} className="rounded-lg bg-foreground px-4 py-3 text-background">{busy ? "Priprema adresnica…" : "Štampaj adresnice"}</button>
        <p className="text-sm text-muted-foreground">Kreiraju se kurirske adresnice; PDF se šalje na magacin@svetpovoljnihcena.rs.</p>
      </>}
      {labelUrl && <LabelPdfActions href={labelUrl} filename={`${session.number}-adresnice.pdf`} />}
      {review.reviewed && review.shortages.length > 0 && <>
        <h2 className="font-semibold">Nedostaje roba za {review.shortages.length} artikala</h2>
        <ul className="space-y-2 text-sm">{review.shortages.map((row, index) => <li key={`${row.sku}-${index}`}>{row.sku} · Odvojeno {row.picked} / {row.required} · Nedostaje {row.missing} kom. · Porudžbine: {row.orders.map(order => order.number).join(", ")}</li>)}</ul>
        <button type="button" disabled={!editable || shortageReported} onClick={() => void finish("shortage")} className="rounded-lg border px-4 py-3">{shortageReported ? "Prijava sačuvana" : "Prijavi manje količine"}</button>
        <p className="text-sm text-muted-foreground">Izveštaj se šalje na podrska@svetpovoljnihcena.rs. Nepotpuna roba se ne šalje automatski.</p>
      </>}
    </section>}
    {!warehouseMode && <p className="text-sm text-muted-foreground">Redosled je po magacinu i podešenom redosledu pozicija. Kod više pozicija proverite raspoloživu robu. Stavke bez pozicije su na kraju svakog magacina. Odvajanje ne zamenjuje potvrdu spakovanih paketa.</p>}
    {!warehouseMode && session.previousPlan && <p className="rounded border border-amber-400 bg-amber-50 p-3 text-amber-950">Sadržaj naloga je menjan posle ranijih skeniranja. Za sadašnji sadržaj roba mora ponovo da se proveri; prethodni zapisi ostaju u istoriji.</p>}
    {!warehouseMode && !session.editable && <p className="rounded border p-3">Nalog je zaključen ili su adresnice već pokrenute. Pregled je dostupan, novo skeniranje je zaključano.</p>}
    {warehouseMode && !review.complete && !labelUrl && articles}
    {session.editable && (!warehouseMode || !review.complete) && <section className="space-y-3 rounded-xl border bg-muted/20 p-4 print:hidden">
      <form onSubmit={e => { e.preventDefault(); scan(); }} className="flex flex-wrap items-end gap-3">
        <label className="min-w-48 flex-1">Skenirajte barkod ili unesite šifru<input ref={input} inputMode={warehouseMode ? "numeric" : undefined} enterKeyHint={warehouseMode ? "done" : undefined} aria-invalid={warehouseMode && scanError ? true : undefined} autoComplete="off" value={code} onChange={e => changeCode(e.target.value)} disabled={!canScan} className="mt-1 w-full rounded border bg-background p-3" /></label>
        <div><label htmlFor="picking-quantity">Količina</label><div className="mt-1 flex items-center gap-2">
          {warehouseMode && <button type="button" aria-label="Smanji količinu" disabled={!canScan || Number(quantity) <= 0} onClick={() => setQuantity(String(Math.max(0, Number(quantity || 0) - 1)))} className="min-h-12 min-w-12 rounded border text-xl">−</button>}
          <input id="picking-quantity" ref={quantityInput} type="number" inputMode={warehouseMode ? "numeric" : undefined} enterKeyHint={warehouseMode ? "done" : undefined} min={warehouseMode ? 0 : 1} max={warehouseMode ? remainingQuantity : 10000} value={quantity} onChange={e => setQuantity(e.target.value)} disabled={!canScan} className="block w-24 rounded border bg-background p-3" />
          {warehouseMode && <button type="button" aria-label="Povećaj količinu" disabled={!canScan || Number(quantity) >= remainingQuantity} onClick={() => setQuantity(String(Math.min(remainingQuantity, Number(quantity || 0) + 1)))} className="min-h-12 min-w-12 rounded border text-xl">+</button>}
        </div></div>
        {warehouseMode ? <div className="flex w-full justify-between gap-3">
          <button type="button" disabled={!canScan} ref={cameraButton} onClick={toggleCamera} className="rounded border px-4 py-3">Kamera</button>
          <button disabled={!canScan} className="rounded bg-foreground px-4 py-3 text-background">Evidentiraj</button>
        </div> : <>
        <button disabled={!canScan} className="rounded bg-foreground px-4 py-3 text-background">Evidentiraj</button>
        <button type="button" disabled={!canScan} ref={cameraButton} onClick={toggleCamera} className="rounded border px-4 py-3">Kamera</button>
        </>}
      </form>
      {warehouseMode ? <Dialog open={camera} onOpenChange={open => { if (!open) closeCamera(); }}>
        <DialogContent keepMounted={cameraStarted} showCloseButton={false} className="sm:max-w-lg" finalFocus={() => validCameraScan.current ? quantityInput.current : cameraButton.current}>
          <DialogTitle>Skeniraj barkod</DialogTitle>
          <DialogDescription>{currentRow?.sku} · {currentRow?.name}. Posle ispravnog barkoda proverite ponuđenu količinu.</DialogDescription>
          {cameraStarted && <PickingCamera enabled={camera && canScan} onClose={closeCamera} onCode={cameraCode} />}
          {scanError && <p role="alert" className="rounded-lg border border-red-500 bg-red-50 p-3 font-semibold text-red-800">{message}</p>}
        </DialogContent>
      </Dialog> : camera && <PickingCamera enabled={canScan} onClose={closeCamera} onCode={cameraCode} />}
      {!warehouseMode && <p className="text-sm">Ručni skener šalje šifru i Enter. Jedan sken dodaje izabranu količinu (podrazumevano 1). Za pogrešan unos koristite −1 na odgovarajućem redu.</p>}
    </section>}
    {(!warehouseMode || !camera) && <div role={warehouseMode && scanError ? "alert" : "status"} aria-live={warehouseMode && scanError ? "assertive" : "polite"} className={warehouseMode && scanError ? "rounded-lg border border-red-500 bg-red-50 p-3 font-semibold text-red-800 print:hidden" : "print:hidden"}>{message}</div>}
    {retry && <div className="flex flex-wrap gap-3 rounded border border-amber-400 p-3 print:hidden"><button disabled={busy} onClick={() => void send(retry)} className="rounded border px-3 py-2">Ponovi isti zahtev</button><button disabled={busy} onClick={() => window.location.reload()} className="rounded border px-3 py-2">Učitaj stanje sa servera</button></div>}
    {!session.rows.length && <p>Nema aktivnih stavki za odvajanje u ovom nalogu.</p>}
    {!warehouseMode && articles}
    {!warehouseMode && note && <form className="space-y-2 rounded border p-4 print:hidden" onSubmit={e => { e.preventDefault(); record(noteKey, 0, note); }}><label className="block">Napomena za izabrani red<textarea value={note} onChange={e => setNote(e.target.value)} maxLength={1000} required className="mt-1 w-full rounded border p-3" /></label><button disabled={!editable} className="rounded bg-foreground px-4 py-2 text-background">Sačuvaj napomenu</button><button type="button" onClick={() => setNote("")} className="ml-3">Odustani</button></form>}
    {!warehouseMode && <details className="rounded border p-4 print:hidden"><summary>Istorija odvajanja (poslednjih 100 zapisa)</summary><ul className="mt-3 space-y-2 text-sm">{session.events.map(e => <li key={e.id}>{new Date(e.createdAt).toLocaleString("sr-RS", { timeZone: "Europe/Belgrade" })} · {e.actorName} · {session.rows.find(r => r.key === e.rowKey)?.sku ?? e.rowKey} · {e.delta > 0 ? "+" : ""}{e.delta} kom. {e.note} {e.planHash !== session.planHash ? "(prethodni sadržaj naloga)" : ""}</li>)}</ul></details>}
  </div>;
}
