import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { ShieldCheck } from "lucide-react";
import { CustomerLoginFields, LoginError, type LoginErrorCode } from "./form";
import {
  getConfiguredSocialAuthProviders,
  SocialAuthButtons,
} from "@/components/account/social-auth-buttons";
import { getCurrentUser } from "@/lib/auth/session";
import { signIn } from "@/lib/auth/auth";
import { customerCallback } from "@/lib/auth/customer-callback";
import { appleAction, facebookAction, googleAction } from "../auth-actions";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = {
  title: "Prijava",
  description: `Prijavite se na svoj ${BRAND.name} nalog.`,
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

async function loginAction(formData: FormData) {
  "use server";

  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const remember = String(formData.get("remember") ?? "") === "true";
  const callbackUrl = customerCallback(
    String(formData.get("callbackUrl") ?? ""),
  );

  try {
    await signIn("credentials", {
      email,
      password,
      remember,
      redirect: true,
      redirectTo: callbackUrl,
    });
  } catch (err) {
    if (err instanceof AuthError) {
      const error: LoginErrorCode =
        err.type === "CredentialsSignin" || err.type === "CallbackRouteError"
          ? "invalid"
          : "generic";
      redirect(
        `/nalog/prijava?error=${error}&callbackUrl=${encodeURIComponent(callbackUrl)}`,
      );
    }
    throw err;
  }
}

export default async function CustomerLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: LoginErrorCode; callbackUrl?: string }>;
}) {
  const sp = await searchParams;
  const callbackUrl = customerCallback(sp.callbackUrl);
  const user = await getCurrentUser();

  if (user?.userType === "customer") redirect(callbackUrl);

  const socialProviders = getConfiguredSocialAuthProviders(
    {
      google: googleAction,
      facebook: facebookAction,
      apple: appleAction,
    },
    { includeUnavailable: true },
  );
  const registrationHref = `/nalog/registracija?callbackUrl=${encodeURIComponent(callbackUrl)}`;

  return (
    <div className="mx-auto grid w-full max-w-[var(--container-page)] gap-5 px-4 py-5 md:grid-cols-[minmax(0,1fr)_minmax(360px,440px)] md:gap-10 md:px-6 md:py-20">
      <section className="flex flex-col justify-center">
        <h1 className="font-display max-w-xl text-3xl text-ink-900 md:text-6xl">
          Prijava za bržu kupovinu
        </h1>
        <p className="mt-2 max-w-[58ch] text-sm leading-snug text-ink-600 md:mt-5 md:text-lg md:leading-relaxed">
          Sačuvajte listu želja, pratite porudžbine i nastavite kupovinu tamo
          gde ste stali.
        </p>
        <div className="mt-3 grid grid-cols-2 gap-1.5 text-[12px] leading-tight text-ink-700 md:mt-6 md:gap-2 md:text-sm">
          {[
            "Sačuvani favoriti",
            "Brža sledeća porudžbina",
            "Status isporuke",
            "Posebne ponude za nalog",
          ].map((item) => (
            <div key={item} className="flex min-w-0 items-center gap-1.5">
              <ShieldCheck className="size-3.5 shrink-0 text-walnut md:size-4" aria-hidden />
              <span>{item}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-border/70 bg-surface p-4 shadow-sm md:rounded-2xl md:p-8">
        <AuthTabs active="login" registrationHref={registrationHref} loginHref={`/nalog/prijava?callbackUrl=${encodeURIComponent(callbackUrl)}`} />
        <h2 className="font-display text-xl text-ink-900 md:text-2xl">Prijavite se</h2>
        <p className="mt-0.5 text-xs text-ink-500 md:mt-1 md:text-sm">
          Koristite e-poštu i lozinku za svoj korisnički nalog.
        </p>

        <div className="mt-3 md:mt-5">
          <LoginError error={sp.error} />
        </div>

        <SocialAuthButtons
          callbackUrl={callbackUrl}
          intent="login"
          providers={socialProviders}
          showDivider={false}
        />

        <div className="mt-4 flex items-center gap-3 text-[11px] tracking-[0.14em] text-ink-400 uppercase md:mt-6 md:text-xs md:tracking-[0.18em]">
          <span className="h-px flex-1 bg-border" />
          ili nastavite e-poštom
          <span className="h-px flex-1 bg-border" />
        </div>

        <form action={loginAction} className="mt-4 md:mt-5">
          <input type="hidden" name="callbackUrl" value={callbackUrl} />
          <CustomerLoginFields />
        </form>

        <p className="mt-4 text-center text-sm text-ink-500 md:mt-6">
          Nemate nalog?{" "}
          <Link
            href={registrationHref}
            className="font-medium text-walnut hover:underline"
          >
            Registrujte se.
          </Link>
        </p>
        <Link
          href="/"
          className="mt-2 inline-flex w-full justify-center text-sm font-medium text-walnut hover:underline md:mt-3"
        >
          Nazad u prodavnicu
        </Link>
      </section>
    </div>
  );
}

function AuthTabs({
  active,
  loginHref,
  registrationHref,
}: {
  active: "login" | "register";
  loginHref: string;
  registrationHref: string;
}) {
  return (
    <nav className="mb-4 grid grid-cols-2 rounded-lg bg-muted-bg p-1 text-sm font-semibold md:mb-5" aria-label="Nalog">
      <Link
        href={loginHref}
        aria-current={active === "login" ? "page" : undefined}
        className={`rounded-md px-3 py-1.5 text-center transition md:py-2 ${
          active === "login" ? "bg-white text-ink-900 shadow-soft-1" : "text-ink-600 hover:text-ink-900"
        }`}
      >
        Prijava
      </Link>
      <Link
        href={registrationHref}
        aria-current={active === "register" ? "page" : undefined}
        className={`rounded-md px-3 py-1.5 text-center transition md:py-2 ${
          active === "register" ? "bg-white text-ink-900 shadow-soft-1" : "text-ink-600 hover:text-ink-900"
        }`}
      >
        Registracija
      </Link>
    </nav>
  );
}
