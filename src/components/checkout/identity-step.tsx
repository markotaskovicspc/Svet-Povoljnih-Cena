"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { motion } from "framer-motion";
import {
  CheckCircle2,
  LogIn,
  UserPlus,
  UserRound,
  Mail,
  Phone,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { IdentityChoice } from "@/lib/checkout/store";
import { SocialProviderMark } from "@/components/account/social-auth-buttons";

/**
 * Step 1 — three identity cards. The choice is bubbled to the parent (via
 * `onPick`) so it can be persisted in the checkout store and the next step can
 * unlock. Real auth wiring lands in Phase 3 (NextAuth providers).
 */
export function IdentityStep({
  value,
  authenticatedCustomer,
  onPick,
  onAuthenticatedContinue,
}: {
  value: IdentityChoice | null;
  authenticatedCustomer?: {
    name?: string | null;
    email?: string | null;
  };
  onPick: (c: IdentityChoice) => void;
  onAuthenticatedContinue?: () => void;
}) {
  const [showSocial, setShowSocial] = useState<"login" | "register" | null>(
    authenticatedCustomer
      ? null
      : value === "login" || value === "register"
        ? value
        : null,
  );
  const [providers, setProviders] = useState<Record<string, unknown> | null>(null);
  const [socialError, setSocialError] = useState<string | null>(null);
  const [pendingProvider, setPendingProvider] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (authenticatedCustomer) return;
    let cancelled = false;
    fetch("/api/auth/providers")
      .then((response) => response.json())
      .then((data) => {
        if (!cancelled) setProviders(data ?? {});
      })
      .catch(() => {
        if (!cancelled) setProviders({});
      });
    return () => {
      cancelled = true;
    };
  }, [authenticatedCustomer]);

  function handleSocial(providerId: string) {
    setSocialError(null);
    onPick(showSocial ?? "login");
    if (providers && !providers[providerId]) {
      setSocialError(`${providerLabel(providerId)} prijava nije konfigurisana.`);
      return;
    }
    setPendingProvider(providerId);
    startTransition(() => {
      void signIn(providerId, { callbackUrl: "/checkout/podaci" })
        .catch(() => {
          setSocialError(
            `${providerLabel(providerId)} prijava trenutno nije dostupna. Pokušajte drugim načinom prijave.`,
          );
        })
        .finally(() => setPendingProvider(null));
    });
  }

  const choices: {
    id: IdentityChoice;
    icon: React.ElementType;
    title: string;
    desc: string;
    accent?: string;
  }[] = [
    {
      id: "login",
      icon: LogIn,
      title: "Prijavi se",
      desc: "Vaši podaci, adrese i sačuvane kartice su već spremni.",
    },
    {
      id: "register",
      icon: UserPlus,
      title: "Registruj se",
      desc: "Ostvari 5% popusta na prvu kupovinu i prati status porudžbine.",
      accent: "Novo: 5% na prvu kupovinu",
    },
    {
      id: "guest",
      icon: UserRound,
      title: "Nastavi kao gost",
      desc: "Bez registracije — samo unesite podatke za isporuku.",
    },
  ];

  if (authenticatedCustomer) {
    const displayName =
      authenticatedCustomer.name?.trim() ||
      authenticatedCustomer.email?.trim() ||
      "Vaš nalog";

    return (
      <div className="rounded-2xl border border-border/70 bg-surface p-4 shadow-sm md:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-xl bg-action text-white">
              <CheckCircle2 className="size-5" aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="text-xs font-medium tracking-wide text-ink-500 uppercase">
                Kupujete kao ulogovan korisnik
              </p>
              <p className="font-display mt-1 truncate text-xl text-ink-900">
                {displayName}
              </p>
              {authenticatedCustomer.email ? (
                <p className="mt-1 truncate text-sm text-ink-500">
                  {authenticatedCustomer.email}
                </p>
              ) : null}
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              onPick("login");
              onAuthenticatedContinue?.();
            }}
            className="bg-ink-900 hover:bg-walnut focus-visible:ring-walnut/40 inline-flex shrink-0 items-center justify-center gap-2 rounded-full px-4 py-2.5 text-sm font-medium text-canvas transition focus-visible:ring-2 focus-visible:outline-none"
          >
            Nastavi sa ovim nalogom
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-3 md:grid-cols-3">
      {choices.map((c) => {
        const Icon = c.icon;
        const active = value === c.id;
        const cardClassName = cn(
          "bg-surface ring-border/60 group flex h-full min-h-[92px] flex-row items-center gap-3 rounded-lg p-3 text-left ring-1 transition focus-visible:outline-none md:min-h-0 md:rounded-2xl md:flex-col md:items-start md:gap-3 md:p-5",
          "hover:ring-walnut/40 hover:shadow-soft-2",
          "focus-visible:ring-walnut/40 focus-visible:ring-2",
          active && "ring-walnut shadow-soft-3 ring-2",
        );
        const content = (
          <>
            <span
              className={cn(
                "inline-flex size-11 shrink-0 items-center justify-center rounded-xl md:size-10",
                active ? "bg-brand-blue text-white" : "bg-muted-bg text-ink-700",
              )}
              aria-hidden
            >
              <Icon className="size-5" />
            </span>
            <div className="flex flex-1 flex-col gap-0.5 md:gap-1">
              <span className="font-display text-base text-ink-900 md:text-lg">
                {c.title}
              </span>
              <span className="text-xs text-ink-500 md:text-sm">{c.desc}</span>
              {c.accent ? (
                <span className="bg-olive/10 text-olive mt-1 inline-flex w-fit rounded-full px-2 py-0.5 text-[11px] font-medium">
                  {c.accent}
                </span>
              ) : null}
            </div>
          </>
        );
        return c.id === "guest" ? (
          <button
            key={c.id}
            type="button"
            onClick={() => {
              onPick(c.id);
              setShowSocial(null);
            }}
            aria-pressed={active}
            className={cardClassName}
          >
            {content}
          </button>
        ) : (
          <Link
            key={c.id}
            href={`/nalog/${c.id === "login" ? "prijava" : "registracija"}?callbackUrl=${encodeURIComponent("/checkout/podaci")}`}
            onClick={() => {
              onPick(c.id);
              setShowSocial(c.id as "login" | "register");
            }}
            aria-pressed={active}
            className={cardClassName}
          >
            {content}
          </Link>
        );
      })}

      {showSocial ? (
        <motion.div
          key={showSocial}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          className="md:col-span-3"
        >
          <div className="bg-surface ring-border/60 mt-1 rounded-2xl p-5 ring-1">
            <p className="text-sm font-medium text-ink-900">
              {showSocial === "login"
                ? "Prijavite se brzo putem"
                : "Registracija putem"}
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              {[
                { id: "google" as const, label: "Google" },
                { id: "apple" as const, label: "Apple" },
                { id: "facebook" as const, label: "Facebook" },
              ].map(({ id, label }) => (
                <button
                  key={id}
                  type="button"
                  disabled={isPending && pendingProvider === id}
                  className="ring-border/60 hover:bg-muted-bg focus-visible:ring-walnut/40 inline-flex items-center justify-center gap-2 rounded-full px-4 py-2.5 text-sm font-medium text-ink-900 ring-1 transition focus-visible:ring-2 focus-visible:outline-none"
                  onClick={() => handleSocial(id)}
                >
                  <SocialProviderMark id={id} />
                  {pendingProvider === id ? "Otvaranje..." : label}
                </button>
              ))}
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                className="ring-border/60 hover:bg-muted-bg focus-visible:ring-walnut/40 inline-flex items-center justify-center gap-2 rounded-full px-4 py-2.5 text-sm text-ink-900 ring-1 transition focus-visible:ring-2 focus-visible:outline-none"
                onClick={() => onPick(showSocial)}
              >
                <Mail className="size-4" aria-hidden />
                E-pošta i lozinka
              </button>
              <button
                type="button"
                className="ring-border/60 hover:bg-muted-bg focus-visible:ring-walnut/40 inline-flex items-center justify-center gap-2 rounded-full px-4 py-2.5 text-sm text-ink-900 ring-1 transition focus-visible:ring-2 focus-visible:outline-none"
                onClick={() => onPick(showSocial)}
              >
                <Phone className="size-4" aria-hidden />
                SMS kod (OTP)
              </button>
            </div>
            {socialError ? (
              <p className="mt-3 text-[11px] text-action" aria-live="polite">
                {socialError}
              </p>
            ) : null}
          </div>
        </motion.div>
      ) : null}
    </div>
  );
}

function providerLabel(providerId: string) {
  if (providerId === "google") return "Google";
  if (providerId === "apple") return "Apple";
  if (providerId === "facebook") return "Facebook";
  return "Društvena";
}
