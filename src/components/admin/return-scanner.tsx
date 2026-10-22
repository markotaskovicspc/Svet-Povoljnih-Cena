"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Field } from "./field";
import { PickingCamera } from "./picking-camera";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";

function subscribePointer(callback: () => void) {
  const media = window.matchMedia("(pointer: coarse)");
  media.addEventListener("change", callback);
  return () => media.removeEventListener("change", callback);
}
const coarsePointer = () => window.matchMedia("(pointer: coarse)").matches;
const serverPointer = () => false;

export function ReturnScanner({ initialCode = "", initialCamera = false, warehouseId = "", awaitingReceipt = false, basePath = "/admin/erp/povrati", children }: { initialCode?: string; initialCamera?: boolean; warehouseId?: string; awaitingReceipt?: boolean; basePath?: "/admin/erp/povrati" | "/admin/magacin/povrat"; children?: ReactNode }) {
  const form = useRef<HTMLFormElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [cameraOverride, setCamera] = useState<boolean | null>(null);
  const isCoarsePointer = useSyncExternalStore(subscribePointer, coarsePointer, serverPointer);
  const camera = cameraOverride ?? (initialCamera && isCoarsePointer);
  const [error, setError] = useState("");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  useEffect(() => {
    // Keep keyboard-wedge scanners ready without opening the phone keyboard.
    if (window.matchMedia("(pointer: fine)").matches) input.current?.focus();
  }, []);
  function scanned(code: string) {
    setCamera(false);
    const value = code.trim();
    if (!value || value.length > 40) {
      setError("Očitani kod nije broj adresnice. Skenirajte barkod paketa ili unesite broj ručno.");
      return;
    }
    if (!input.current || !form.current) return;
    input.current.value = value;
    // Lookup only: receiving goods still requires its separate confirmation.
    form.current.requestSubmit();
  }
  return <>
    <form ref={form} action={basePath} method="get" onSubmit={event => {
      event.preventDefault();
      const code = input.current?.value.trim() ?? "";
      if (!code || code.length > 40) { setError("Unesite ili skenirajte kod paketa."); return; }
      setError(""); setCamera(false);
      startTransition(() => {
        if (code === initialCode) router.refresh();
        else router.push(`${basePath}?q=${encodeURIComponent(code)}${warehouseId ? `&warehouse=${encodeURIComponent(warehouseId)}` : ""}`, { scroll: false });
      });
    }} className="space-y-3" aria-busy={pending}>
      <Field label="Skeniraj paket ili unesi broj porudžbine" className="min-w-0 w-full">
        <input ref={input} name="q" defaultValue={initialCode} disabled={pending} maxLength={40} autoComplete="off" placeholder="Kod sa adresnice / Ananas broj" className="h-11 w-full max-w-full rounded-lg border border-input px-3" />
      </Field>
      <div className={`grid gap-2 ${initialCode ? "grid-cols-3" : "grid-cols-2"}`} data-return-scanner-actions>
      <button disabled={pending} className="min-h-11 min-w-0 rounded-lg bg-foreground px-2 py-2 text-sm font-medium text-background">{pending ? "Pronalazim paket…" : "Pronađi paket"}</button>
      <button type="button" disabled={pending} aria-expanded={camera} onClick={() => { input.current?.blur(); setError(""); setCamera(!camera); }} className="min-h-11 min-w-0 rounded-lg border border-border px-2 py-2 text-sm font-medium">Skeniraj kamerom</button>
      {initialCode && awaitingReceipt ? <button type="button" disabled title="Prvo potvrdite prijem pronađenog paketa." className="min-h-11 min-w-0 rounded-lg border border-border px-2 py-2 text-sm text-ink-500 opacity-60">Sledeći paket</button> : initialCode ? <Link href={`${basePath}?camera=1${warehouseId ? `&warehouse=${encodeURIComponent(warehouseId)}` : ""}`} className="flex min-h-11 min-w-0 items-center justify-center rounded-lg bg-emerald-700 px-2 py-2 text-center text-sm font-medium text-white hover:bg-emerald-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600">Sledeći paket</Link> : null}
      </div>
    </form>
    <Dialog open={camera} onOpenChange={setCamera}><DialogContent className="sm:max-w-lg"><DialogTitle>Skeniraj paket</DialogTitle><DialogDescription>Usmerite kameru ka barkodu na adresnici. Skeniranje samo pronalazi paket; prijem robe potvrđujete posebno.</DialogDescription>{camera && <PickingCamera onCode={value => { if (!value.trim() || value.trim().length > 40) return false; scanned(value); return true; }} onClose={() => setCamera(false)} />}</DialogContent></Dialog>
    {error && <p role="alert" className="mt-3 text-warning">{error}</p>}
    {awaitingReceipt && <p role="status" className="mt-3 text-sm font-medium text-warning">Paket još nije primljen. Pregledajte robu i potvrdite prijem.</p>}
    <p className="mt-3 text-xs text-ink-500">Na telefonu kliknite „Skeniraj kamerom“. Barkod čitačem skenirajte u polje iznad ili unesite broj ručno.</p>
    {pending ? <p role="status" className="mt-4 text-sm">Pronalazim paket…</p> : children}
  </>;
}
