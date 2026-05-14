"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { Sparkles, X, Clock3 } from "lucide-react";
import type { PromoBar as PromoBarData } from "@/types";

const STORAGE_KEY = "spc-promobar-dismissed";
const STORAGE_EVENT = "spc-promobar-dismissed-change";
const COUNTDOWN_THRESHOLD_MS = 72 * 60 * 60 * 1000;

function subscribeDismissed(onStoreChange: () => void) {
  window.addEventListener(STORAGE_EVENT, onStoreChange);
  window.addEventListener("storage", onStoreChange);
  return () => {
    window.removeEventListener(STORAGE_EVENT, onStoreChange);
    window.removeEventListener("storage", onStoreChange);
  };
}

function getDismissedSnapshot() {
  try {
    return sessionStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function pad(n: number) {
  return n.toString().padStart(2, "0");
}

function formatRemaining(ms: number) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

interface PromoBarProps {
  bar: PromoBarData;
}

export function PromoBar({ bar }: PromoBarProps) {
  const dismissed = useSyncExternalStore(
    subscribeDismissed,
    getDismissedSnapshot,
    () => false,
  );
  const [now, setNow] = useState<number | null>(null);

  const endsAt = bar.endsAt ? new Date(bar.endsAt).getTime() : undefined;
  const showCountdown =
    !!endsAt && now !== null && endsAt - now > 0 && endsAt - now <= COUNTDOWN_THRESHOLD_MS;

  useEffect(() => {
    if (!endsAt) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [endsAt]);

  if (!bar.enabled) return null;

  const handleDismiss = () => {
    try {
      sessionStorage.setItem(STORAGE_KEY, "1");
      window.dispatchEvent(new Event(STORAGE_EVENT));
    } catch {
      // ignore
    }
  };

  const Inner = (
    <span className="inline-flex items-center gap-2">
      <Sparkles className="size-3.5 opacity-80" aria-hidden />
      <span>{bar.text}</span>
      {showCountdown && endsAt !== null && now !== null ? (
        <span
          className="ml-1 inline-flex items-center gap-1 rounded-full bg-white/15 px-2 py-0.5 text-[11px] font-mono text-white"
          aria-live="polite"
        >
          <Clock3 className="size-3" aria-hidden />
          {formatRemaining(endsAt - now)}
        </span>
      ) : null}
    </span>
  );

  return (
    <AnimatePresence initial={false}>
      {!dismissed ? (
        <motion.div
          key="promobar"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
          className="relative isolate overflow-hidden border-b border-white/10 bg-brand-blue text-white"
        >
          <div className="mx-auto flex max-w-[var(--container-page)] items-center justify-center gap-3 px-6 py-2 text-center text-xs sm:text-sm">
            {bar.href ? (
              <Link
                href={bar.href}
                className="underline-offset-4 hover:underline focus-visible:underline"
              >
                {Inner}
              </Link>
            ) : (
              Inner
            )}
            <button
              type="button"
              onClick={handleDismiss}
              aria-label="Zatvori traku sa obaveštenjem"
              className="absolute top-1/2 right-3 -translate-y-1/2 rounded-full p-1 text-white/80 transition hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            >
              <X className="size-3.5" aria-hidden />
            </button>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
