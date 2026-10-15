"use client";

import { useRef, useState, useSyncExternalStore } from "react";

/** Native file sharing exposes iOS Print even inside a home-screen web app. */
export function LabelPdfActions({ href, filename, label = "Štampaj adresnice · PDF" }: {
  href: string;
  filename: string;
  label?: string;
}) {
  const canShare = useSyncExternalStore(subscribe, supportsFileSharing, () => false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const prepared = useRef<{ href: string; file: File } | null>(null);
  const inFlight = useRef(false);


  async function sharePdf() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setMessage("");
    try {
      if (prepared.current?.href !== href) {
        const response = await fetch(href, { cache: "no-store", credentials: "same-origin" });
        if (!response.ok || !response.headers.get("content-type")?.includes("application/pdf")) {
          throw new Error("PDF nije spreman. Otvorite adresnice za detalje greške.");
        }
        const file = new File([await response.blob()], filename, { type: "application/pdf" });
        prepared.current = { href, file };
      }
      // Fetching a large PDF may outlive Safari's click activation. Retain it in
      // memory so the next explicit tap opens sharing without another request.
      if (navigator.userActivation && !navigator.userActivation.isActive) {
        setMessage("PDF je spreman. Pritisnite ponovo „Podeli / štampaj PDF“, pa izaberite Štampaj.");
        return;
      }
      await navigator.share({ files: [prepared.current!.file] });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      setMessage(error instanceof Error && error.name === "NotAllowedError"
        ? "PDF je spreman. Pritisnite ponovo „Podeli / štampaj PDF“, pa izaberite Štampaj."
        : error instanceof Error ? error.message : "Štampa nije dostupna. Otvorite PDF.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return <div className="space-y-2 print:hidden">
    <div className="flex flex-wrap gap-3">
      <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex rounded-lg bg-foreground px-4 py-3 text-background">{label}</a>
      {canShare && <button type="button" disabled={busy} onClick={() => void sharePdf()} className="rounded-lg border px-4 py-3 disabled:opacity-50">{busy ? "Priprema PDF-a…" : "Podeli / štampaj PDF"}</button>}
    </div>
    {message && <p role="status" className="text-sm">{message}</p>}
  </div>;
}

function subscribe() { return () => {}; }
function supportsFileSharing() {
  try {
    return Boolean(typeof navigator.share === "function" && typeof navigator.canShare === "function" && navigator.canShare({
      files: [new File(["%PDF-"], "adresnice.pdf", { type: "application/pdf" })],
    }));
  } catch { return false; }
}
