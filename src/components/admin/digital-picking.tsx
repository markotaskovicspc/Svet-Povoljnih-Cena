"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { getPickingSession } from "@/lib/admin/picking.server";
import { recordPicking } from "@/app/admin/erp/preuzimanja/[id]/picking/actions";
type Session = Awaited<ReturnType<typeof getPickingSession>>;
type ScanRequest = Parameters<typeof recordPicking>[0];

function Camera({ onCode, onClose }: { onCode: (code: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState("");
  const callback = useRef(onCode);
  useEffect(() => { callback.current = onCode; }, [onCode]);
  useEffect(() => {
    let cancelled = false;
    let controls: { stop: () => void } | undefined;
    let stream: MediaStream | undefined;
    const start = async () => {
      try {
        const { BrowserMultiFormatReader } = await import("@zxing/browser");
        if (cancelled) return;
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
        controls = await new BrowserMultiFormatReader().decodeFromStream(stream, video.current!, (result, _error, ctl) => {
          if (!cancelled && result) { cancelled = true; ctl.stop(); stream?.getTracks().forEach(t => t.stop()); callback.current(result.getText()); }
        });
        if (cancelled) controls.stop();
      } catch { if (!cancelled) setError("Kamera nije dostupna. Dozvolite pristup kameri ili koristite skener / ručni unos."); }
    };
    void start();
    return () => { cancelled = true; controls?.stop(); stream?.getTracks().forEach(t => t.stop()); };
  }, []);
  return <div className="rounded-xl border bg-black p-3 text-white"><video ref={video} muted playsInline className="max-h-64 w-full" /><p role="status">{error || "Usmerite kameru ka barkodu. Posle očitavanja potvrdite količinu."}</p><button type="button" onClick={onClose} className="mt-2 rounded border px-4 py-2">Zatvori kameru</button></div>;
}

export function DigitalPicking({ initial }: { initial: Session }) {
  const [session, setSession] = useState(initial);
  const [code, setCode] = useState("");
  const [camera, setCamera] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [retry, setRetry] = useState<ScanRequest | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [note, setNote] = useState("");
  const [noteKey, setNoteKey] = useState("");
  const total = session.rows.reduce((sum, r) => sum + r.quantity, 0);
  const done = session.rows.reduce((sum, r) => sum + (session.progress[r.key] ?? 0), 0);
  const editable = session.editable && !busy && !retry;
  async function send(request: ScanRequest) {
    if (lock.current) return;
    lock.current = true; setBusy(true);
    try {
      const response = await recordPicking(request);
      if (response.ok && response.result) {
        setSession(response.result); setRetry(null); setCode(""); setNote(""); setQuantity(1);
        setMessage(response.message); input.current?.focus();
      } else { setMessage(response.message); setRetry(request); }
    } catch { setRetry(request); setMessage("Potvrda nije stigla. Proverite vezu pa ponovite isti zahtev — neće biti duplog evidentiranja."); }
    finally { lock.current = false; setBusy(false); }
  }
  function record(key: string, delta: number, text = "") {
    if (!editable) return;
    void send({ id: crypto.randomUUID(), batchId: session.id, planHash: session.planHash, rowKey: key, delta, note: text });
  }
  function scan() {
    const value = code.trim();
    if (!value) return;
    const matches = session.rows.filter(r => (r.barcode === value || r.sku === value) && (session.progress[r.key] ?? 0) < r.quantity);
    const row = matches.length === 1 ? matches[0] : matches.find(r => r.key === selected);
    if (!row) { setMessage(matches.length ? "Ista šifra je u više magacina. Izaberite odgovarajući red pa ponovite sken." : "Šifra nije na ovom nalogu ili je sva količina već odvojena."); return; }
    if (!Number.isSafeInteger(quantity) || quantity < 1) { setMessage("Unesite pozitivnu celu količinu."); return; }
    record(row.key, quantity);
  }
  return <div className="space-y-5 p-4 md:p-8">
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4">
      <div><strong className="text-2xl">{done} / {total} kom.</strong><p>{total > 0 && done === total ? "Roba je odvojena. Nastavite sa proverom pakovanja i dimenzija na nalogu." : "Odvojeno / potrebno"}</p></div>
      <div className="flex gap-2 print:hidden"><Link href="/admin/erp/picking-pozicije" className="rounded border px-3 py-2">Pozicije</Link><button onClick={() => window.print()} className="rounded border px-3 py-2">Štampaj putanju</button><button disabled={busy || !!retry} onClick={() => { window.location.reload(); }} className="rounded border px-3 py-2">Osveži</button></div>
    </div>
    <p className="text-sm text-muted-foreground">Redosled je po magacinu i podešenom redosledu pozicija. Kod više pozicija proverite raspoloživu robu. Stavke bez pozicije su na kraju svakog magacina. Odvajanje ne zamenjuje potvrdu spakovanih paketa.</p>
    {session.previousPlan && <p className="rounded border border-amber-400 bg-amber-50 p-3 text-amber-950">Sadržaj naloga je menjan posle ranijih skeniranja. Za sadašnji sadržaj roba mora ponovo da se proveri; prethodni zapisi ostaju u istoriji.</p>}
    {!session.editable && <p className="rounded border p-3">Nalog je zaključen ili su adresnice već pokrenute. Pregled je dostupan, novo skeniranje je zaključano.</p>}
    {session.editable && <section className="space-y-3 rounded-xl border bg-muted/20 p-4 print:hidden">
      <form onSubmit={e => { e.preventDefault(); scan(); }} className="flex flex-wrap items-end gap-3">
        <label className="min-w-48 flex-1">Skenirajte barkod ili unesite šifru<input ref={input} autoComplete="off" value={code} onChange={e => setCode(e.target.value)} disabled={!editable} className="mt-1 w-full rounded border bg-background p-3" /></label>
        <label>Količina<input type="number" min={1} max={10000} value={quantity} onChange={e => setQuantity(Number(e.target.value))} disabled={!editable} className="mt-1 block w-24 rounded border bg-background p-3" /></label>
        <button disabled={!editable} className="rounded bg-foreground px-4 py-3 text-background">Evidentiraj</button>
        <button type="button" disabled={!editable} onClick={() => setCamera(!camera)} className="rounded border px-4 py-3">Kamera</button>
      </form>
      {camera && <Camera onClose={() => setCamera(false)} onCode={value => { setCode(value); setCamera(false); setMessage(`Očitano: ${value}. Proverite količinu i kliknite Evidentiraj.`); }} />}
      <p className="text-sm">Ručni skener šalje šifru i Enter. Jedan sken dodaje izabranu količinu (podrazumevano 1). Za pogrešan unos koristite −1 na odgovarajućem redu.</p>
    </section>}
    <div role="status" aria-live="polite" className="print:hidden">{message}</div>
    {retry && <div className="flex flex-wrap gap-3 rounded border border-amber-400 p-3 print:hidden"><button disabled={busy} onClick={() => void send(retry)} className="rounded border px-3 py-2">Ponovi isti zahtev</button><button disabled={busy} onClick={() => window.location.reload()} className="rounded border px-3 py-2">Učitaj stanje sa servera</button></div>}
    {!session.rows.length && <p>Nema aktivnih stavki za odvajanje u ovom nalogu.</p>}
    <div className="space-y-3">{session.rows.map(row => {
      const count = session.progress[row.key] ?? 0;
      return <article key={row.key} className={`break-inside-avoid rounded-xl border p-4 ${count === row.quantity ? "border-emerald-300 bg-emerald-50 text-emerald-950" : ""} ${selected === row.key ? "ring-2 ring-blue-500" : ""}`}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex gap-4"><div className="min-w-16 text-center"><span className="text-xs">POZICIJA</span><div className="text-2xl font-bold">{row.positions.join(", ") || "—"}</div></div><div><h2 className="font-semibold">{row.sku} · {row.name}</h2><p className="text-sm">{row.warehouseName} · Barkod: {row.barcode || "Nije upisan"}</p><p className="mt-2 text-sm">{row.allocations.map(a => `${a.orderNumber}: ${a.quantity} kom.`).join(" · ")}</p></div></div>
          <strong className="text-xl">{count} / {row.quantity}</strong>
        </div>
        {session.editable && <div className="mt-3 flex flex-wrap gap-2 print:hidden"><button disabled={!editable} onClick={() => setSelected(row.key)} className="rounded border px-3 py-2">{selected === row.key ? "Izabran red" : "Izaberi za sken"}</button><button disabled={!editable || count >= row.quantity} onClick={() => record(row.key, 1, "Ručna potvrda odvajanja")} className="rounded border px-4 py-2">+1</button><button disabled={!editable || count === 0} onClick={() => record(row.key, -1, "Ispravka količine")} className="rounded border px-4 py-2">−1</button><button disabled={!editable} onClick={() => { setSelected(row.key); setNoteKey(row.key); setNote(`Nedostaje ${row.quantity - count} kom. za ${row.sku}. `); }} className="rounded border px-3 py-2">Nedostaje / napomena</button></div>}
      </article>;
    })}</div>
    {note && <form className="space-y-2 rounded border p-4 print:hidden" onSubmit={e => { e.preventDefault(); record(noteKey, 0, note); }}><label className="block">Napomena za izabrani red<textarea value={note} onChange={e => setNote(e.target.value)} maxLength={1000} required className="mt-1 w-full rounded border p-3" /></label><button disabled={!editable} className="rounded bg-foreground px-4 py-2 text-background">Sačuvaj napomenu</button><button type="button" onClick={() => setNote("")} className="ml-3">Odustani</button></form>}
    <details className="rounded border p-4 print:hidden"><summary>Istorija odvajanja (poslednjih 100 zapisa)</summary><ul className="mt-3 space-y-2 text-sm">{session.events.map(e => <li key={e.id}>{new Date(e.createdAt).toLocaleString("sr-RS", { timeZone: "Europe/Belgrade" })} · {e.actorName} · {session.rows.find(r => r.key === e.rowKey)?.sku ?? e.rowKey} · {e.delta > 0 ? "+" : ""}{e.delta} kom. {e.note} {e.planHash !== session.planHash ? "(prethodni sadržaj naloga)" : ""}</li>)}</ul></details>
  </div>;
}
