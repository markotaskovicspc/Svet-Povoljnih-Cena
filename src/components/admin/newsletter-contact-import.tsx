"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "./field";
import { CONTACT_IMPORT_BATCH_SIZE, CONTACT_IMPORT_MAX_BYTES, contactImportFields, contactTableFromRows, guessContactColumns, parseContactCsv, parsePastedContacts, prepareContactImport, type ContactColumnMapping, type ContactImportTable } from "@/lib/newsletter/import-parser";

const labels = { email: "Email adresa", firstName: "Ime", lastName: "Prezime", fullName: "Puno ime", consent: "Saglasnost", consentedAt: "Datum saglasnosti", source: "Izvor", language: "Jezik" };
type Prepared = ReturnType<typeof prepareContactImport>;
type ImportState = { id: string; nextBatch: number; importedCount: number; complete: boolean };
async function request(body: unknown): Promise<ImportState> {
  const response = await fetch("/api/admin/newsletter/contact-import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(55_000) });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.ok) throw new Error(result?.error || "Veza je prekinuta. Kliknite „Nastavi uvoz“; završeni paketi se neće ponavljati.");
  return result;
}
export function NewsletterContactImport() {
  const router = useRouter();
  const [mode, setMode] = useState("file"); const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState(""); const [listName, setListName] = useState("");
  const [table, setTable] = useState<ContactImportTable | null>(null); const [mapping, setMapping] = useState<ContactColumnMapping>({});
  const [confirmed, setConfirmed] = useState(false); const [source, setSource] = useState("");
  const [prepared, setPrepared] = useState<Prepared | null>(null); const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(""); const [error, setError] = useState("");
  const [progress, setProgress] = useState(0); const [complete, setComplete] = useState(false); const [started, setStarted] = useState(false);
  const pause = useRef(false);
  const importIds = useRef(new Map<string, string>());
  useEffect(() => {
    if (!busy) return;
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", guard); return () => window.removeEventListener("beforeunload", guard);
  }, [busy]);
  function invalidate() { setPrepared(null); setStarted(false); setComplete(false); setProgress(0); setError(""); setMessage(""); }
  async function analyze() {
    setBusy(true); setError(""); setMessage("");
    try {
      let next = table; let columns = mapping;
      if (!next) {
        if (mode === "text") next = parsePastedContacts(text);
        else {
          if (!file) throw new Error("Izaberite CSV ili XLSX fajl.");
          if (file.size > CONTACT_IMPORT_MAX_BYTES) throw new Error("Fajl je veći od 50 MB.");
          if (/\.xlsx$/i.test(file.name)) {
            const ExcelJS = (await import("exceljs")).default;
            const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(await file.arrayBuffer());
            const sheet = workbook.worksheets[0]; if (!sheet) throw new Error("Excel fajl nema tabelu.");
            if (sheet.actualRowCount > 100_001 || sheet.actualColumnCount > 50) throw new Error("Dozvoljeno je najviše 100.000 kontakata i 50 kolona.");
            const rows: string[][] = [];
            sheet.eachRow({ includeEmpty: false }, (row) => {
              const cells: string[] = [];
              for (let column = 1; column <= row.cellCount; column++) {
                const value = row.getCell(column).value;
                cells.push(value instanceof Date ? value.toISOString() : row.getCell(column).text);
              }
              rows.push(cells);
            });
            next = contactTableFromRows(rows);
          } else if (/\.csv$/i.test(file.name)) next = contactTableFromRows(parseContactCsv(await file.text()));
          else throw new Error("Podržani su CSV i XLSX fajlovi.");
        }
        columns = guessContactColumns(next.headers); setTable(next); setMapping(columns);
      }
      setPrepared(prepareContactImport(next, columns, { confirmed, source }));
      setComplete(false); setStarted(false); setProgress(0);
      setMessage("Provera je završena. Ništa još nije upisano niti poslato.");
    } catch (error) { setPrepared(null); setError(error instanceof Error ? error.message : "Provera nije uspela."); }
    finally { setBusy(false); }
  }
  async function upload() {
    if (!prepared || !listName.trim()) { setError("Unesite naziv custom liste i prvo proverite kontakte."); return; }
    setBusy(true); setStarted(true); setError(""); setMessage(""); pause.current = false;
    try {
      const consentEvidence = confirmed ? source.trim() : null;
      const fingerprint = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify({ listName: listName.trim(), contacts: prepared.contacts, consentEvidence }))))).map((n) => n.toString(16).padStart(2, "0")).join("");
      const storageKey = `newsletter-import:${fingerprint}`;
      let id = importIds.current.get(fingerprint) || crypto.randomUUID();
      try { id = sessionStorage.getItem(storageKey) || id; sessionStorage.setItem(storageKey, id); } catch { /* Keep the in-memory checkpoint when storage is disabled. */ }
      importIds.current.set(fingerprint, id);
      let state = await request({ operation: "start", id, fingerprint, listName: listName.trim(), fileName: mode === "file" ? file?.name.slice(0, 160) : "copy-paste", totalContacts: prepared.contacts.length, consentEvidence });
      setProgress(state.importedCount);
      while (!state.complete && !pause.current) {
        const offset = state.nextBatch * CONTACT_IMPORT_BATCH_SIZE;
        state = await request({ operation: "batch", id, batch: state.nextBatch, contacts: prepared.contacts.slice(offset, offset + CONTACT_IMPORT_BATCH_SIZE) });
        setProgress(state.importedCount);
      }
      setComplete(state.complete);
      setMessage(state.complete ? `Custom lista „${listName.trim()}“ je spremna. Uvezeno ${state.importedCount.toLocaleString("sr-Latn-RS")} kontakata. Možete je izabrati u kampanji.` : "Uvoz je pauziran. Kliknite „Nastavi uvoz“ kada budete spremni.");
      router.refresh();
    } catch (error) { setError(error instanceof Error ? error.message : "Uvoz nije uspeo. Možete nastaviti."); }
    finally { setBusy(false); }
  }
  return <div data-testid="newsletter-contact-import" className="space-y-5">
    <fieldset disabled={busy} className="space-y-4 disabled:opacity-70">
      <Field label="Naziv custom liste" hint="Isti naziv dopunjuje postojeću listu. Kontakti se povezuju po email adresi."><Input name="listName" value={listName} onChange={(e) => { setListName(e.target.value); setComplete(false); setStarted(false); }} maxLength={150} placeholder="Na primer: Sajam septembar 2026" /></Field>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Način unosa kontakata">
        <Button type="button" variant={mode === "file" ? "default" : "outline"} onClick={() => { setMode("file"); setTable(null); invalidate(); }}>CSV / Excel fajl</Button>
        <Button type="button" variant={mode === "text" ? "default" : "outline"} onClick={() => { setMode("text"); setTable(null); invalidate(); }}>Copy-paste adrese ili tabela</Button>
      </div>
      {mode === "file" ? <Field label="Fajl sa kontaktima" hint="CSV ili XLSX, do 50 MB i 100.000 kontakata. Email je obavezan; ostale kolone se čuvaju."><Input name="contactsFile" type="file" accept=".csv,.xlsx" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setTable(null); invalidate(); }} /></Field>
        : <Field label="Nalepite kontakte" hint="60–70 hiljada adresa je podržano. Odvojite ih novim redom, zarezom ili tačkom-zarezom; možete nalepiti i tabelu iz Excela sa zaglavljem."><textarea className="min-h-48 w-full rounded-lg border border-input bg-surface p-3 font-mono text-xs" value={text} onChange={(e) => { setText(e.target.value); setTable(null); invalidate(); }} placeholder={'ana@primer.rs\nmarko@primer.rs'} /></Field>}
      {table ? <div className="rounded-xl border border-border p-4"><p className="mb-3 text-sm font-medium">Povežite kolone. Ostala polja se čuvaju kao dodatni podaci.</p><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{contactImportFields.map((field) => <Field key={field} label={labels[field]}><select className="h-9 min-w-0 rounded-lg border border-input bg-surface px-2 text-sm" value={mapping[field] ?? -1} onChange={(e) => { setMapping((current) => ({ ...current, [field]: Number(e.target.value) >= 0 ? Number(e.target.value) : undefined })); invalidate(); }}><option value={-1}>Nije zadato</option>{table.headers.map((header, index) => <option key={index} value={index}>{header}</option>)}</select></Field>)}</div></div> : null}
      <div className="rounded-xl border border-border bg-muted-bg/30 p-4 text-sm">
        <label className="flex items-start gap-3"><input type="checkbox" checked={confirmed} onChange={(e) => { setConfirmed(e.target.checked); invalidate(); }} className="mt-1" /><span>Za kontakte bez kolone saglasnosti potvrđujem da imam dokumentovanu saglasnost za promotivne mejlove.</span></label>
        {confirmed ? <div className="mt-3"><Field label="Izvor / dokaz saglasnosti"><Input value={source} onChange={(e) => { setSource(e.target.value); invalidate(); }} maxLength={500} placeholder="Npr. prijavni formular na sajmu, septembar 2026" /></Field></div> : null}
        <p className="mt-2 text-xs text-ink-500">Bez saglasnosti kontakt se sačuva u listi, ali ne dobija kampanje. Postojeće odjave i zabrane slanja imaju prednost. Sam uvoz ne šalje mejlove.</p>
      </div>
      <Button type="button" variant="outline" onClick={analyze}>Proveri kontakte</Button>
    </fieldset>
    {prepared ? <div className="space-y-3 rounded-xl border border-border p-4">
      <p className="text-sm">Ispravnih: <strong>{prepared.uniqueValid.toLocaleString("sr-Latn-RS")}</strong> · Duplikata: {prepared.duplicateRows.toLocaleString("sr-Latn-RS")} · Neispravnih: {prepared.invalidRows.toLocaleString("sr-Latn-RS")} · Sa saglasnošću u uvozu: {prepared.explicitConsent.toLocaleString("sr-Latn-RS")} · Bez saglasnosti u uvozu: {prepared.withoutConsent.toLocaleString("sr-Latn-RS")}</p>
      <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr><th>Email</th><th>Ime</th><th>Prezime</th><th>Dodatna polja</th></tr></thead><tbody>{prepared.contacts.slice(0, 5).map((contact) => <tr key={contact.email}><td className="py-2">{contact.email}</td><td>{contact.firstName || "—"}</td><td>{contact.lastName || "—"}</td><td>{Object.keys(contact.customFields).join(", ") || "—"}</td></tr>)}</tbody></table></div>
      {started ? <div><progress className="w-full" max={prepared.uniqueValid} value={progress} aria-label="Napredak uvoza" /><p className="text-sm">Sačuvano {progress.toLocaleString("sr-Latn-RS")} / {prepared.uniqueValid.toLocaleString("sr-Latn-RS")}</p></div> : null}
      <div className="flex flex-wrap gap-3"><Button type="button" disabled={busy || complete || !listName.trim()} onClick={upload}>{busy ? "Uvozim…" : complete ? "Lista je sačuvana" : started ? "Nastavi uvoz" : "Sačuvaj u custom listu"}</Button>{busy && started ? <Button type="button" variant="outline" onClick={() => { pause.current = true; setMessage("Pauziram posle trenutnog paketa…"); }}>Pauziraj</Button> : null}{complete ? <Link href="/admin/newsletter?view=audiences" className="self-center text-sm text-walnut underline">Otvori svoje liste</Link> : null}</div>
    </div> : null}
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    {message ? <p role="status" className="text-sm text-ink-700">{message}</p> : null}
  </div>;
}
