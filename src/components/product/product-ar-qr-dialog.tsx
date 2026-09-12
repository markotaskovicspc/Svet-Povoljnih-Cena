"use client";
import { useState, type RefObject } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { QrCode } from "./ar-qr-code";

export default function ProductArQrDialog({ url, onClose, trigger }: { url: string; onClose: () => void; trigger: RefObject<HTMLButtonElement | null> }) {
  const [copyStatus, setCopyStatus] = useState("");
  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent className="text-center" finalFocus={trigger}>
      <DialogTitle className="pr-5 text-xl">Pogledaj u svojoj sobi</DialogTitle>
      <DialogDescription>Skenirajte QR kod kamerom telefona da otvorite AR. Ako telefon zatraži potvrdu, dodirnite „Pokreni AR”.</DialogDescription>
      <div className="mx-auto rounded-xl bg-white p-3"><QrCode value={url} size={232} /></div>
      <p className="text-xs text-ink-600">iPhone: Safari · Android: Chrome sa AR podrškom</p>
      <button type="button" className="min-h-11 rounded-full bg-ink-900 px-5 py-2.5 text-sm font-semibold text-white"
        onClick={() => { void navigator.clipboard.writeText(url).then(() => setCopyStatus("Link je kopiran")).catch(() => setCopyStatus("Kopiranje nije uspelo. Link možete otvoriti ispod.")); }}>Kopiraj link</button>
      {copyStatus && <p role="status" className="text-xs">{copyStatus}</p>}
      <a href={url} className="break-all text-xs text-ink-600 underline">{url}</a>
    </DialogContent>
  </Dialog>;
}
