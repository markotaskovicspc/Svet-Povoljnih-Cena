"use client";

import { useState } from "react";
import { MessageCircle, X } from "lucide-react";

export function MessengerContact() {
  const [open, setOpen] = useState(false);
  return <div className="fixed right-[max(1rem,env(safe-area-inset-right))] bottom-[max(1rem,env(safe-area-inset-bottom))] z-40">
    {open && <section aria-label="Svet Povoljnih Cena — Messenger" className="mb-3 w-[min(320px,calc(100vw-2rem))] rounded-2xl border border-border bg-white p-5 shadow-soft-5">
      <div className="flex items-start justify-between gap-3">
        <div><p className="font-semibold text-ink-900">Svet Povoljnih Cena</p><p className="text-sm text-ink-500">Korisnička podrška · Messenger</p></div>
        <button type="button" onClick={() => setOpen(false)} aria-label="Zatvori Messenger" className="rounded p-1"><X className="size-4" /></button>
      </div>
      <p className="my-4 text-sm text-ink-700">Pitajte nas za proizvod, dostavu ili porudžbinu. Nastavite razgovor sa našom stranicom u Messengeru.</p>
      <a href="https://m.me/61584691594219" target="_blank" rel="noopener noreferrer" className="flex justify-center rounded-lg bg-[#0866ff] px-4 py-3 text-sm font-medium text-white">Otvori Messenger</a>
    </section>}
    <button type="button" aria-label="Pišite nam na Messengeru" aria-expanded={open} onClick={() => setOpen(!open)} className="ml-auto flex size-12 items-center justify-center rounded-full bg-[#0866ff] text-white shadow-soft-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0866ff]">
      {open ? <X className="size-6" /> : <MessageCircle className="size-6" />}
    </button>
  </div>;
}
