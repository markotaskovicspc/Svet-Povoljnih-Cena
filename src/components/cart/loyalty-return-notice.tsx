"use client";
import { useSyncExternalStore } from "react";
const subscribe = () => () => {};
const getStatus = () => new URLSearchParams(window.location.search).get("loyalty");
export function LoyaltyReturnNotice() {
  const status = useSyncExternalStore(subscribe, getStatus, () => null);
  if (!status) return null;
  return <p role="status" className="mb-4 rounded-xl border border-border bg-muted-bg p-4 text-sm">
    {status === "confirmed" ? "Mejl je potvrđen. Vaše loyalty pogodnosti su aktivne. Možete nastaviti kupovinu." :
      status === "invalid" ? "Link je istekao ili je već iskorišćen. Ako pogodnosti nisu aktivne, izaberite „Želim loyalty karticu“ i zatražite novi link." :
      "Potvrda trenutno nije dostupna. Pokušajte ponovo da otvorite link iz mejla."}
  </p>;
}
