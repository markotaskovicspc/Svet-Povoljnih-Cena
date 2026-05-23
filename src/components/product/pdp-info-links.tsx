"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export type PdpInfoKey = "deliveryTerms" | "declaration" | "assemblyInstructions" | "maintenance";

const LABELS: Record<PdpInfoKey, string> = {
  deliveryTerms: "Uslovi isporuke",
  declaration: "Deklaracija",
  assemblyInstructions: "Uputstvo za sastavljanje",
  maintenance: "Kako održavati",
};

export function PdpInfoLinks({
  sections,
}: {
  sections: Partial<Record<PdpInfoKey, string>>;
}) {
  const items = (Object.keys(LABELS) as PdpInfoKey[]).map((key) => ({
    key,
    label: LABELS[key],
    content: sections[key]?.trim() || defaultContent(key),
  }));
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<PdpInfoKey>("deliveryTerms");

  function show(key: PdpInfoKey) {
    setExpanded(key);
    setOpen(true);
  }

  return (
    <>
      <div className="border-border/70 divide-border/70 divide-y border-y">
        {items.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => show(item.key)}
            className="group flex min-h-13 w-full items-center justify-between gap-4 py-3 text-left text-sm font-semibold text-ink-900 transition hover:text-brand-blue focus-visible:ring-2 focus-visible:ring-brand-blue/35 focus-visible:outline-none"
          >
            <span>{item.label}</span>
            <ChevronDown
              className="size-4 -rotate-90 text-ink-500 transition group-hover:text-brand-blue"
              aria-hidden
            />
          </button>
        ))}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl bg-white p-0">
          <DialogHeader className="border-border/60 border-b px-5 pt-5 pb-4">
            <DialogTitle className="font-display text-xl text-ink-900">
              Informacije o proizvodu
            </DialogTitle>
          </DialogHeader>
          <div className="max-h-[70vh] overflow-y-auto p-5">
            {items.map((item) => {
              const isExpanded = expanded === item.key;
              return (
                <section key={item.key} className="border-border/60 border-b last:border-0">
                  <button
                    type="button"
                    onClick={() => setExpanded(item.key)}
                    aria-expanded={isExpanded}
                    className="flex w-full items-center justify-between gap-3 py-4 text-left text-sm font-semibold text-ink-900"
                  >
                    {item.label}
                    <ChevronDown
                      className={cn("size-4 text-ink-500 transition", isExpanded && "rotate-180")}
                      aria-hidden
                    />
                  </button>
                  {isExpanded ? (
                    <div className="pb-4 text-sm leading-relaxed whitespace-pre-line text-ink-700">
                      {item.content}
                    </div>
                  ) : null}
                </section>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function defaultContent(key: PdpInfoKey) {
  switch (key) {
    case "deliveryTerms":
      return "Rok i način isporuke zavise od adrese, raspoloživosti artikla i izabranog načina dostave. Konačan obračun prikazuje se u checkout-u.";
    case "declaration":
      return "Deklaracija je dostupna u administraciji proizvoda i biće prikazana čim se unese za ovaj artikal.";
    case "assemblyInstructions":
      return "Uputstvo za sastavljanje je dostupno za proizvode koji zahtevaju montažu. Ako proizvod ne zahteva montažu, ovaj odeljak je informativan.";
    case "maintenance":
      return "Održavajte proizvod prema materijalu i nameni. Koristite blaga sredstva i izbegavajte abrazivne površine.";
  }
}
