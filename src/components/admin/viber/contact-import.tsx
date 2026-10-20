"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Audience = { id: string; name: string; description: string };
type Preview = { totalRows: number; unique: number; duplicates: number; invalid: number; invalidRows: number[]; blocked: number; eligible: number; samples: { phone: string; name: string }[]; columns: { index: number; label: string }[]; phoneColumn: number; digest: string };
export function PhoneContactImport({ channel, onSaved }: { channel: "VIBER" | "SMS"; onSaved: (audience: Audience) => void }) {
  const [file, setFile] = useState<File>();
  const [name, setName] = useState("");
  const [column, setColumn] = useState("");
  const [combine, setCombine] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [preview, setPreview] = useState<Preview>();
  const [columns, setColumns] = useState<Preview["columns"]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(commit: boolean) {
    if (!file || busy) return;
    setBusy(true); setError("");
    const form = new FormData();
    form.set("file", file); form.set("channel", channel); form.set("column", column); form.set("combine", String(combine));
    form.set("name", name); form.set("mode", commit ? "commit" : "preview"); form.set("digest", preview?.digest ?? ""); form.set("confirmed", String(confirmed));
    try {
      const response = await fetch("/api/admin/messaging-contact-import", { method: "POST", body: form });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Uvoz nije uspeo.");
      setPreview(result); setColumns(result.columns); setColumn(String(result.phoneColumn));
      if (commit && result.audience) onSaved(result.audience);
    } catch (e) { setError(e instanceof Error ? e.message : "Uvoz nije uspeo. Pokušajte ponovo."); }
    finally { setBusy(false); }
  }
  return <details className="rounded-lg border border-border p-4">
    <summary className="cursor-pointer text-sm font-medium">Dodaj kontakte iz Excel tabele</summary>
    <div className="mt-4 space-y-4 text-sm">
      <p className="text-ink-500">XLSX ili CSV do 4 MB. Prvi list tabele, kolona „Telefon“ ili „Broj telefona“. Može i lista brojeva bez zaglavlja. Brojevi se čuvaju kao posebna publika za {channel === "VIBER" ? "Viber" : "SMS"}.</p>
      <label className="block space-y-2">Tabela sa kontaktima<Input type="file" accept=".xlsx,.csv" disabled={busy} onChange={e => { const f = e.target.files?.[0]; setFile(f); setName(f?.name.replace(/\.[^.]+$/, "") ?? ""); setColumn(""); setColumns([]); setPreview(undefined); setError(""); setConfirmed(false); }}/></label>
      {columns.length > 0 && <label className="block space-y-2">Kolona sa telefonom<select className="h-10 w-full rounded-lg border border-input bg-background px-3" value={column} disabled={busy} onChange={e => { setColumn(e.target.value); setPreview(undefined); }}>{columns.map(c => <option key={c.index} value={c.index}>{c.label}</option>)}</select></label>}
      <label className="block space-y-2">Naziv publike<Input value={name} maxLength={120} disabled={busy} onChange={e => setName(e.target.value)}/></label>
      <label className="flex items-start gap-2"><input type="checkbox" className="mt-1" checked={combine} disabled={busy} onChange={e => { setCombine(e.target.checked); setPreview(undefined); }}/><span>Dodaj i postojeće kupce i kontakte iz baze. Isti broj dobija jednu poruku.</span></label>
      <Button variant="outline" disabled={!file || busy} onClick={() => void submit(false)}>{busy ? "Provera…" : "Pregledaj brojeve"}</Button>
      {preview && <div className="space-y-3 rounded-lg bg-muted-bg p-3" role="status">
        <p>Redova: <strong>{preview.totalRows}</strong> · Jedinstvenih brojeva: <strong>{preview.unique}</strong></p>
        <p>Duplikata: {preview.duplicates} · Neispravnih redova: {preview.invalid} · Evidentiranih odjava: {preview.blocked}</p>
        {preview.invalidRows.length > 0 && <p className="text-xs text-ink-500">Proverite redove: {preview.invalidRows.join(", ")}{preview.invalid > 10 ? "…" : ""}.</p>}
        <p className="font-medium">Za slanje: {preview.eligible.toLocaleString("sr-RS")} primalaca</p>
        {preview.samples.length > 0 && <p className="break-words text-xs text-ink-500">Primeri: {preview.samples.map(s => `+${s.phone}${s.name ? ` (${s.name})` : ""}`).join(", ")}</p>}
        <label className="flex items-start gap-2"><input type="checkbox" className="mt-1" checked={confirmed} disabled={busy} onChange={e => setConfirmed(e.target.checked)}/><span>Potvrđujem da su ovi kontakti zainteresovani za {channel === "VIBER" ? "Viber" : "SMS"} poruke.</span></label>
        <p className="text-xs text-ink-500">Uvoz ne menja podešavanja naloga i ne vraća odjavljene brojeve.</p>
        <Button disabled={busy || !name.trim() || !confirmed || !preview.unique || !preview.eligible} onClick={() => void submit(true)}>{busy ? "Čuvanje…" : "Sačuvaj publiku i izaberi"}</Button>
        <p className="text-xs text-ink-500">Čuva se samo publika. Kampanju šaljete u posebnom koraku.</p>
      </div>}
      {error && <p role="alert" className="text-destructive">{error}</p>}
    </div>
  </details>;
}
