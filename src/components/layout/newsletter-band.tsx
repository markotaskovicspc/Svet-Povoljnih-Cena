"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight, Check, Mail } from "lucide-react";
import { cn } from "@/lib/utils";

export function NewsletterBand({ className }: { className?: string }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (state === "submitting") return;
    const trimmed = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setError("Unesite ispravnu email adresu.");
      setState("error");
      return;
    }
    setError(null);
    setState("submitting");
    // Phase 1 mock: just delay. Real submit lands in Phase 5 (Resend).
    await new Promise((r) => setTimeout(r, 600));
    setState("success");
  };

  return (
    <section className={cn("border-y border-border bg-muted-bg/60", className)}>
      <div className="mx-auto grid max-w-[var(--container-content)] gap-8 px-6 py-16 md:grid-cols-2 md:items-center md:py-24">
        <div>
          <p className="font-mono text-[11px] tracking-[0.2em] text-ink-500 uppercase">
            Newsletter
          </p>
          <h2 className="font-display mt-3 text-3xl leading-[1.15] text-ink-900 md:text-4xl">
            Otkrijte akcije ranije od svih
          </h2>
          <p className="mt-3 max-w-prose text-ink-700">
            Najavljujemo nedeljne akcije, nove kolekcije i Heroje meseca direktno u sandučetu.
            Bez spama — možete odjaviti pretplatu jednim klikom.
          </p>
        </div>
        <form onSubmit={onSubmit} className="md:justify-self-end md:max-w-md md:w-full">
          <AnimatePresence mode="wait">
            {state === "success" ? (
              <motion.div
                key="ok"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="flex items-center gap-3 rounded-2xl border border-success/30 bg-success/10 px-4 py-4 text-sm text-ink-900"
              >
                <span className="inline-flex size-8 items-center justify-center rounded-full bg-success/20 text-success">
                  <Check className="size-4" aria-hidden />
                </span>
                Hvala! Potvrdite pretplatu na vašoj email adresi.
              </motion.div>
            ) : (
              <motion.div
                key="form"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
              >
                <label htmlFor="newsletter-email" className="sr-only">
                  Email adresa
                </label>
                <div className="relative flex items-stretch overflow-hidden rounded-full border border-border bg-surface shadow-soft-1 focus-within:border-walnut focus-within:ring-2 focus-within:ring-walnut/20">
                  <Mail className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-ink-500" aria-hidden />
                  <input
                    id="newsletter-email"
                    type="email"
                    required
                    autoComplete="email"
                    placeholder="vasa@email.rs"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      if (state === "error") setState("idle");
                    }}
                    aria-invalid={state === "error"}
                    className="h-12 w-full bg-transparent pr-44 pl-11 text-sm text-ink-900 placeholder:text-ink-500 outline-none"
                  />
                  <button
                    type="submit"
                    disabled={state === "submitting"}
                    className="absolute top-1 right-1 inline-flex h-10 items-center gap-2 rounded-full bg-ink-900 px-4 text-sm text-canvas transition hover:bg-walnut disabled:opacity-60"
                  >
                    {state === "submitting" ? "Slanje…" : "Pretplati se"}
                    <ArrowRight className="size-4" aria-hidden />
                  </button>
                </div>
                {error ? (
                  <p className="mt-2 pl-4 text-xs text-action" role="alert">
                    {error}
                  </p>
                ) : (
                  <p className="mt-2 pl-4 text-xs text-ink-500">
                    Pretplatom prihvatate{" "}
                    <a href="/politika-privatnosti" className="underline underline-offset-4">
                      politiku privatnosti
                    </a>
                    .
                  </p>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </form>
      </div>
    </section>
  );
}
