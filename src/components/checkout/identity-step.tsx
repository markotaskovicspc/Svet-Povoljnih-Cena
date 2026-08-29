"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import {
  BadgePercent,
  CheckCircle2,
  LogIn,
  UserPlus,
  UserRound,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { IdentityChoice } from "@/lib/checkout/store";
import type { SocialAuthProvider } from "@/components/account/social-auth-buttons";
import {
  CustomerAuthMethods,
  type CustomerAuthFormAction,
} from "@/components/account/customer-auth-methods";
import type { LoginErrorCode } from "@/app/(account)/nalog/prijava/form";
import type { RegistrationErrorCode } from "@/app/(account)/nalog/registracija/form";

/**
 * Step 1 — three identity cards. The choice is bubbled to the parent (via
 * `onPick`) so it can be persisted in the checkout store. Every advertised
 * auth option must navigate to a complete flow; incomplete transports stay
 * hidden until they are actually available.
 */
export function IdentityStep({
  value,
  authenticatedCustomer,
  onPick,
  onAuthenticatedContinue,
  socialProviders = [],
  loginAction,
  registrationAction,
  initialAuthIntent,
  loginError,
  registrationError,
}: {
  value: IdentityChoice | null;
  authenticatedCustomer?: {
    name?: string | null;
    email?: string | null;
  };
  onPick: (c: IdentityChoice) => void;
  onAuthenticatedContinue?: () => void;
  socialProviders?: SocialAuthProvider[];
  loginAction?: CustomerAuthFormAction;
  registrationAction?: CustomerAuthFormAction;
  initialAuthIntent?: "login" | "register";
  loginError?: LoginErrorCode;
  registrationError?: RegistrationErrorCode;
}) {
  const [showAuth, setShowAuth] = useState<"login" | "register" | null>(
    authenticatedCustomer
      ? null
      : initialAuthIntent ??
          (value === "login" || value === "register" ? value : null),
  );

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
      desc: "Ostvari 15% popusta na prvu kupovinu. Kod nije potreban.",
      accent: "Novo: 15% na prvu kupovinu",
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
        <div className="border-olive/25 bg-olive/5 mt-4 flex items-start gap-3 rounded-xl border px-3.5 py-3">
          <BadgePercent
            className="text-olive mt-0.5 size-5 shrink-0"
            aria-hidden
          />
          <div>
            <p className="text-sm font-semibold text-ink-900">
              15% popusta za prvu kupovinu
            </p>
            <p className="mt-0.5 text-xs leading-relaxed text-ink-600 sm:text-sm">
              Ako vam je ovo prva kupovina, popust se obračunava automatski
              nakon potvrde porudžbine. Vaučer ili promo kod nije potreban.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-3 md:grid-cols-3">
      {choices.map((c) => {
        const Icon = c.icon;
        const active =
          c.id === "guest" ? value === "guest" && !showAuth : showAuth === c.id;
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
        return (
          <button
            key={c.id}
            type="button"
            onClick={() => {
              onPick(c.id);
              setShowAuth(c.id === "guest" ? null : c.id);
            }}
            aria-pressed={active}
            aria-expanded={c.id === "guest" ? undefined : active}
            className={cardClassName}
          >
            {content}
          </button>
        );
      })}

      {showAuth && loginAction && registrationAction ? (
        <motion.div
          key={showAuth}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          className="md:col-span-3"
        >
          <div className="bg-surface ring-border/60 mt-1 rounded-2xl p-5 ring-1">
            <p className="font-display text-lg text-ink-900">
              {showAuth === "login" ? "Prijavite se" : "Kreirajte nalog"}
            </p>
            <p className="mt-1 text-sm text-ink-500">
              {showAuth === "login"
                ? "Izaberite isti način prijave koji koristite na stranici naloga."
                : "Najbrže je preko Google, Apple ili Facebook naloga."}
            </p>
            <CustomerAuthMethods
              callbackUrl="/checkout/podaci"
              intent={showAuth}
              providers={socialProviders}
              loginAction={loginAction}
              registrationAction={registrationAction}
              surface="checkout"
              loginError={showAuth === "login" ? loginError : undefined}
              registrationError={
                showAuth === "register" ? registrationError : undefined
              }
            />
          </div>
        </motion.div>
      ) : null}
    </div>
  );
}
