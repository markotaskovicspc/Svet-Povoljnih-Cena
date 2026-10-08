"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Field } from "./field";
import { startBarcodeCamera } from "@/lib/barcode-camera";

function ReturnCamera({ onCode, onClose }: { onCode: (code: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const callback = useRef(onCode);
  const [error, setError] = useState("");
  useEffect(() => { callback.current = onCode; }, [onCode]);
  useEffect(() => {
    let active = true;
    const camera = startBarcodeCamera(video.current!, code => callback.current(code));
    void camera.ready.catch(() => {
      if (active) setError("Kamera nije dostupna. Dozvolite pristup kameri u pregledaču ili unesite broj sa adresnice ručno.");
    });
    return () => { active = false; camera.stop(); };
  }, []);
  return <div className="mt-3 space-y-3 rounded-xl border border-border bg-black p-3 text-white">
    <video ref={video} muted playsInline aria-label="Kamera za skeniranje adresnice" className="max-h-80 w-full rounded-lg" />
    <p role="status">{error || "Usmerite zadnju kameru ka barkodu na kurirskoj adresnici. Očitani paket će se automatski otvoriti."}</p>
    <button type="button" onClick={onClose} className="rounded-lg border border-white/60 px-4 py-2">Zatvori kameru</button>
  </div>;
}

export function ReturnScanner({ initialCode = "" }: { initialCode?: string }) {
  const form = useRef<HTMLFormElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [camera, setCamera] = useState(false);
  const [error, setError] = useState("");
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
    <form ref={form} action="/admin/erp/povrati" method="get" className="flex flex-wrap items-end gap-3">
      <Field label="Skeniraj paket ili unesi broj porudžbine">
        <input ref={input} name="q" defaultValue={initialCode} maxLength={40} autoComplete="off" placeholder="Kod sa adresnice" className="h-11 w-80 max-w-full rounded-lg border border-input px-3" />
      </Field>
      <button className="rounded-lg bg-foreground px-4 py-3 text-background">Pronađi paket</button>
      <button type="button" aria-expanded={camera} onClick={() => { input.current?.blur(); setError(""); setCamera(!camera); }} className="rounded-lg border border-border px-4 py-3">Skeniraj kamerom</button>
      {initialCode ? <Link href="/admin/erp/povrati" className="text-sm underline">Sledeći paket</Link> : null}
    </form>
    {camera && <ReturnCamera onCode={scanned} onClose={() => setCamera(false)} />}
    {error && <p role="alert" className="mt-3 text-warning">{error}</p>}
    <p className="mt-3 text-xs text-ink-500">Na telefonu kliknite „Skeniraj kamerom“. Barkod čitačem skenirajte u polje iznad ili unesite broj ručno.</p>
  </>;
}
