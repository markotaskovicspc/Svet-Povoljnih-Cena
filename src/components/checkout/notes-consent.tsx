"use client";

import { useState } from "react";
import { useFormContext } from "react-hook-form";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CheckoutFormData } from "./checkout-flow";

const NOTES_MAX = 500;

/**
 * Step 6 — Free-text notes + required Uslovi kupovine consent.
 */
export function NotesConsent() {
  const {
    register,
    watch,
    formState: { errors, isSubmitted },
  } = useFormContext<CheckoutFormData>();
  const notes = watch("notes") ?? "";
  const consentErr = isSubmitted ? errors.consent?.message : undefined;
  const [openTerms, setOpenTerms] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      <label htmlFor="notes" className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-ink-900">
          Napomene uz porudžbinu (opciono)
        </span>
        <textarea
          id="notes"
          rows={3}
          maxLength={NOTES_MAX}
          placeholder="Npr. radno vreme za prijem, sprat bez lifta, posebne instrukcije…"
          className="ring-border/60 focus-visible:ring-walnut/40 bg-canvas resize-y rounded-xl px-3 py-2 text-sm text-ink-900 ring-1 transition placeholder:text-ink-300 focus-visible:ring-2 focus-visible:outline-none"
          {...register("notes", {
            maxLength: { value: NOTES_MAX, message: `Najviše ${NOTES_MAX} karaktera` },
          })}
        />
        <span className="text-right text-[11px] text-ink-500 tabular-nums">
          {notes.length}/{NOTES_MAX}
        </span>
      </label>

      <div className="bg-muted-bg ring-border/60 flex flex-col gap-2 rounded-2xl p-4 ring-1">
        <label htmlFor="consent" className="flex items-start gap-3 text-sm">
          <input
            id="consent"
            type="checkbox"
            className="accent-walnut mt-0.5 size-4"
            {...register("consent", {
              validate: (v) => v === true || "Saglasnost je obavezna pre porudžbine",
            })}
          />
          <span className="text-ink-700">
            Saglasan/a sam sa{" "}
            <button
              type="button"
              onClick={() => setOpenTerms(true)}
              className="text-walnut hover:text-ink-900 underline-offset-2 hover:underline"
            >
              Uslovima kupovine
            </button>{" "}
            i obradom mojih podataka u skladu sa{" "}
            <a
              href="/politika-privatnosti"
              className="text-walnut hover:text-ink-900 underline-offset-2 hover:underline"
            >
              Politikom privatnosti
            </a>
            .<span className="text-action ml-0.5">*</span>
          </span>
        </label>
        {consentErr ? (
          <p
            className={cn(
              "text-action pl-7 text-[11px]",
              "animate-in fade-in slide-in-from-top-1",
            )}
          >
            {consentErr as string}
          </p>
        ) : null}
        <p className="inline-flex items-center gap-1.5 pl-7 text-[11px] text-ink-500">
          <ShieldCheck className="size-3.5" aria-hidden />
          Sigurna naplata preko IPS i 3-D Secure infrastrukture.
        </p>
      </div>

      <TermsDialog open={openTerms} onOpenChange={setOpenTerms} />
    </div>
  );
}

function TermsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="!max-w-[640px] sm:!max-w-[640px]">
        <DialogTitle className="font-display text-xl text-ink-900">
          Uslovi kupovine
        </DialogTitle>
        <DialogDescription className="text-sm text-ink-700">
          Pregled uslova kupovine pre potvrde porudžbine.
        </DialogDescription>
        <div className="prose prose-sm max-w-none text-ink-700">
          <p>
            Ovo je sažet prikaz uslova kupovine. Kompletan tekst je dostupan na
            stranici{" "}
            <a
              href="/uslovi-kupovine"
              className="text-walnut hover:text-ink-900 underline"
            >
              Uslovi kupovine
            </a>
            .
          </p>
          <ul className="list-inside list-disc space-y-1">
            <li>Cene su izražene u dinarima sa uključenim PDV-om.</li>
            <li>
              Pravo na odustajanje od ugovora — 14 dana od prijema robe (Zakon o
              zaštiti potrošača).
            </li>
            <li>
              Reklamacije se prijavljuju putem stranice „Servis za kupce” ili na
              e-poštu reklamacije@svetpovoljnihcena.rs.
            </li>
            <li>
              Rok isporuke računa se od trenutka potvrde uplate (kartica) ili
              kreiranja porudžbine (pouzeće).
            </li>
          </ul>
        </div>
        <div className="flex justify-end">
          <DialogClose
            render={
              <button
                type="button"
                className="bg-ink-900 hover:bg-walnut focus-visible:ring-walnut/40 inline-flex items-center rounded-full px-4 py-2 text-sm font-medium text-canvas transition focus-visible:ring-2 focus-visible:outline-none"
              >
                Razumem
              </button>
            }
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
