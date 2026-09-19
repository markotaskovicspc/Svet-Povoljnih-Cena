"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "./field";

type Candidate = { id: string; sku: string; name: string; version: string; label: string; familyCode: string | null; familyMembers: number };
export function LinkExistingProduct({ sourceId, sourceVersion }: { sourceId: string; sourceVersion: string }) {
  const router = useRouter();
  const [sku, setSku] = useState(""); const [label, setLabel] = useState("");
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [message, setMessage] = useState("");
  async function find() {
    setBusy(true); setError(""); setMessage(""); setCandidate(null);
    try {
      const response = await fetch(`/api/admin/product-family/link?sku=${encodeURIComponent(sku.trim())}`, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Pretraga nije uspela.");
      if (result.id === sourceId) throw new Error("Unesite šifru drugog artikla.");
      setCandidate(result); setLabel(result.label);
    } catch (e) { setError(e instanceof Error ? e.message : "Pretraga nije uspela."); }
    finally { setBusy(false); }
  }
  async function link() {
    if (!candidate) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/admin/product-family/link", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceId, sourceVersion, targetId: candidate.id, targetVersion: candidate.version, label }), signal: AbortSignal.timeout(30_000) });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || "Povezivanje nije uspelo.");
      setMessage(result.message); setCandidate(null); setSku(""); router.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Povezivanje nije uspelo. Ponovite pretragu."); }
    finally { setBusy(false); }
  }
  return <div className="mt-4 space-y-3 rounded-xl border border-brand-blue/25 bg-brand-blue-50/30 p-4">
    <h3 className="text-sm font-semibold">Poveži postojeći artikal</h3>
    <p className="text-xs text-ink-600">Za drugu veličinu ili boju koja već ima SKU. Povezani artikli zadržavaju svoje nazive, veličine, opise, slike, cene i zalihe. Njihovi podaci se i ubuduće uređuju pojedinačno.</p>
    <div className="flex flex-wrap items-end gap-3"><Field label="SKU postojećeg artikla"><Input value={sku} disabled={busy} maxLength={100} placeholder="npr. 110127" onChange={(e) => { setSku(e.target.value); setCandidate(null); setMessage(""); setError(""); }} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (sku.trim() && !busy) void find(); } }} /></Field><Button type="button" variant="outline" disabled={busy || !sku.trim()} onClick={find}>{busy ? "Sačekajte…" : "Pronađi artikal"}</Button></div>
    {candidate ? <div className="space-y-3 rounded-lg border border-border bg-white p-3">
      <p className="text-sm font-medium">{candidate.name} <span className="font-mono text-xs">· SKU {candidate.sku}</span></p>
      {candidate.familyCode ? <p className="text-xs text-ink-600">Trenutna porodica: {candidate.familyCode} · članova: {candidate.familyMembers}. {candidate.familyMembers > 1 ? "Artikal koji je u drugoj porodici sa više članova prvo treba odvojiti." : "Samostalna porodica biće spojena sa ovom."}</p> : null}
      <Field label="Oznaka varijante" hint="Kupac će videti ovu oznaku u izboru varijanti. Mora biti jedinstvena u porodici."><Input value={label} disabled={busy} maxLength={120} placeholder="npr. S, crna" onChange={(e) => setLabel(e.target.value)} /></Field>
      <Button type="button" disabled={busy || !label.trim()} onClick={link}>Poveži ovaj artikal</Button>
    </div> : null}
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    {message ? <p role="status" className="text-sm text-success">{message}</p> : null}
  </div>;
}
