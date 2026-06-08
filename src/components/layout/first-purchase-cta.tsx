"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronUp, Gift, X } from "lucide-react";

const CLOSED_KEY = "svet-akcija:first-purchase-cta-closed-until";
const MINIMIZED_KEY = "svet-akcija:first-purchase-cta-minimized";
const CLOSE_MS = 7 * 24 * 60 * 60 * 1000;
const SHOW_DELAY_MS = 8000;

export function FirstPurchaseCta() {
  const [visible, setVisible] = useState(false);
  const [minimized, setMinimized] = useState(false);

  useEffect(() => {
    const closedUntil = Number(window.localStorage.getItem(CLOSED_KEY) ?? 0);
    if (closedUntil > Date.now()) return;

    const timeout = window.setTimeout(() => {
      setMinimized(window.localStorage.getItem(MINIMIZED_KEY) === "true");
      setVisible(true);
    }, SHOW_DELAY_MS);
    return () => window.clearTimeout(timeout);
  }, []);

  function close() {
    window.localStorage.setItem(CLOSED_KEY, String(Date.now() + CLOSE_MS));
    window.localStorage.removeItem(MINIMIZED_KEY);
    setVisible(false);
  }

  function toggleMinimized() {
    const next = !minimized;
    window.localStorage.setItem(MINIMIZED_KEY, String(next));
    setMinimized(next);
  }

  if (!visible) return null;

  if (minimized) {
    return (
      <button
        type="button"
        onClick={toggleMinimized}
        className="fixed right-[max(1rem,env(safe-area-inset-right))] bottom-[max(1rem,env(safe-area-inset-bottom))] z-40 inline-flex size-12 items-center justify-center rounded-full bg-ink-900 text-canvas shadow-soft-4 transition hover:bg-walnut focus-visible:ring-2 focus-visible:ring-walnut/40 focus-visible:outline-none"
        aria-label="Prikaži popust za prvu kupovinu"
      >
        <Gift className="size-5" aria-hidden />
      </button>
    );
  }

  return (
    <aside
      aria-label="Popust za prvu kupovinu"
      className="fixed right-[max(1rem,env(safe-area-inset-right))] bottom-[max(1rem,env(safe-area-inset-bottom))] left-[max(1rem,env(safe-area-inset-left))] z-40 rounded-lg border border-border/80 bg-white p-4 shadow-soft-5 sm:left-auto sm:w-[360px]"
    >
      <div className="flex items-start gap-3">
        <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg bg-action text-white">
          <Gift className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold tracking-[0.14em] text-action uppercase">
            Prva kupovina
          </p>
          <h2 className="font-display mt-1 text-xl text-ink-900">
            5% popusta za prvu kupovinu
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-ink-600">
            Registrujte se i popust se automatski aktivira na prvu porudžbinu
            dok ste prijavljeni.
          </p>
        </div>
        <div className="flex shrink-0 gap-1">
          <button
            type="button"
            onClick={toggleMinimized}
            className="inline-flex size-8 items-center justify-center rounded-md text-ink-500 transition hover:bg-muted-bg hover:text-ink-900 focus-visible:ring-2 focus-visible:ring-walnut/40 focus-visible:outline-none"
            aria-label="Minimizuj obaveštenje"
          >
            <ChevronUp className="size-4 rotate-180" aria-hidden />
          </button>
          <button
            type="button"
            onClick={close}
            className="inline-flex size-8 items-center justify-center rounded-md text-ink-500 transition hover:bg-muted-bg hover:text-ink-900 focus-visible:ring-2 focus-visible:ring-walnut/40 focus-visible:outline-none"
            aria-label="Zatvori obaveštenje"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
      </div>
      <Link
        href="/nalog/registracija?offer=first-purchase-5"
        className="mt-4 inline-flex h-10 w-full items-center justify-center rounded-lg bg-ink-900 px-4 text-sm font-medium text-canvas transition hover:bg-walnut focus-visible:ring-2 focus-visible:ring-walnut/40 focus-visible:outline-none"
      >
        Registruj se
      </Link>
    </aside>
  );
}
