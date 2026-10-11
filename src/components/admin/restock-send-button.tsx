"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { sendRestockSegmentAction } from "@/app/admin/newsletter/restock-actions";
export function RestockSendButton({ productId, disabled }: { productId: string; disabled: boolean }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const router = useRouter();
  async function run() {
    setBusy(true); let sent = 0; let review = 0;
    try {
      while (true) {
        const result = await sendRestockSegmentAction(productId);
        sent += result.sent; review += result.review;
        setMessage(`Poslato: ${sent}. Preostalo: ${result.remaining}.${review ? ` Za proveru: ${review}.` : ""}`);
        if (result.disabled) { setMessage("Slanje emailova nije podešeno."); break; }
        if (!result.remaining || !result.sent && !result.skipped && !result.review) break;
      }
    } catch { setMessage("Slanje je zaustavljeno. Proverite status; sačuvana obaveštenja se neće ponovo poslati."); }
    finally { setBusy(false); router.refresh(); }
  }
  return <div className="min-w-48"><Button size="sm" disabled={disabled || busy} onClick={() => void run()}>{busy ? "Šaljem…" : "Obavesti sve zainteresovane"}</Button>{message ? <p role="status" className="mt-1 text-xs text-ink-500">{message}</p> : null}</div>;
}
