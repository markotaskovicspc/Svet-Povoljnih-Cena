"use client";

import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";

export function PurchaseSuggestion({ compact = false }: { compact?: boolean }) {
  return (
    <div className="rounded-2xl bg-muted-bg/70 p-4 ring-1 ring-border/60">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-surface text-walnut ring-1 ring-border/60">
          <Sparkles className="size-4" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink-900">Predlog kupovine</p>
          <p className="mt-1 text-xs leading-relaxed text-ink-500">
            Pogledajte artikle koji se često biraju uz aktuelne akcije.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <SuggestionLink href="/heroji-meseca" label="Heroji meseca" />
            {!compact ? (
              <SuggestionLink href="/specijalne-ponude" label="Specijalne ponude" />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function SuggestionLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1 rounded-full bg-surface px-3 py-1.5 text-xs font-medium text-ink-900 ring-1 ring-border/60 transition hover:text-walnut focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-walnut/40"
    >
      {label}
      <ArrowRight className="size-3" aria-hidden />
    </Link>
  );
}
