import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { Heart, PackageCheck, ShieldCheck, Sparkles } from "lucide-react";

import {
  CustomerRegistrationFields,
  RegistrationError,
  type RegistrationErrorCode,
} from "./form";
import {
  getConfiguredSocialAuthProviders,
  SocialAuthButtons,
} from "@/components/account/social-auth-buttons";
import { getCurrentUser } from "@/lib/auth/session";
import { signIn } from "@/lib/auth/auth";
import { registerCustomer } from "@/lib/auth/credentials";
import { customerCallback } from "@/lib/auth/customer-callback";
import { appleAction, facebookAction, googleAction } from "../auth-actions";

export const metadata: Metadata = {
  title: "Registracija",
  description: "Kreirajte Svet Akcija nalog za bržu kupovinu.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function optionalText(raw: FormDataEntryValue | null) {
  const value = String(raw ?? "").trim();
  return value || undefined;
}

function registrationUrl(error: RegistrationErrorCode, callbackUrl: string) {
  return `/nalog/registracija?error=${error}&callbackUrl=${encodeURIComponent(callbackUrl)}`;
}

async function registerAction(formData: FormData) {
  "use server";

  const callbackUrl = customerCallback(
    String(formData.get("callbackUrl") ?? ""),
  );
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  if (!emailPattern.test(email)) {
    redirect(registrationUrl("invalid_email", callbackUrl));
  }
  if (password.length < 8 || password.length > 200) {
    redirect(registrationUrl("weak_password", callbackUrl));
  }
  if (password !== confirmPassword) {
    redirect(registrationUrl("password_mismatch", callbackUrl));
  }

  let registrationError: RegistrationErrorCode | null = null;

  try {
    await registerCustomer({
      email,
      password,
      firstName: optionalText(formData.get("firstName")),
      lastName: optionalText(formData.get("lastName")),
    });
  } catch (err) {
    registrationError =
      err instanceof Error && err.message === "EMAIL_TAKEN"
        ? "email_taken"
        : "generic";
  }

  if (registrationError) {
    redirect(registrationUrl(registrationError, callbackUrl));
  }

  let signInError = false;

  try {
    await signIn("credentials", {
      email,
      password,
      redirect: true,
      redirectTo: callbackUrl,
    });
  } catch (err) {
    if (err instanceof AuthError) {
      signInError = true;
    } else {
      throw err;
    }
  }

  if (signInError) redirect(registrationUrl("generic", callbackUrl));
}

export default async function CustomerRegistrationPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: RegistrationErrorCode;
    callbackUrl?: string;
  }>;
}) {
  const sp = await searchParams;
  const callbackUrl = customerCallback(sp.callbackUrl);
  const user = await getCurrentUser();

  if (user?.userType === "customer") redirect(callbackUrl);

  const socialProviders = getConfiguredSocialAuthProviders({
    google: googleAction,
    facebook: facebookAction,
    apple: appleAction,
  });
  const loginHref = `/nalog/prijava?callbackUrl=${encodeURIComponent(callbackUrl)}`;

  return (
    <div className="mx-auto grid w-full max-w-[var(--container-page)] gap-10 px-4 py-12 md:grid-cols-[minmax(0,1fr)_minmax(380px,460px)] md:px-6 md:py-20">
      <section className="flex flex-col justify-center">
        <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-walnut">
          Novi nalog
        </p>
        <h1 className="font-display mt-3 max-w-xl text-4xl text-ink-900 md:text-6xl">
          Registracija za lakšu svaku sledeću kupovinu
        </h1>
        <p className="mt-5 max-w-[58ch] text-base leading-relaxed text-ink-600 md:text-lg">
          Otvorite nalog i sačuvajte omiljene proizvode, podatke za kupovinu i
          pregled važnih obaveštenja na jednom mestu.
        </p>
        <div className="mt-8 grid gap-3 text-sm text-ink-700 sm:grid-cols-2">
          {[
            { label: "Lista želja uvek pri ruci", icon: Heart },
            { label: "Brža kupovina sledeći put", icon: Sparkles },
            { label: "Sigurna prijava", icon: ShieldCheck },
            { label: "Pregled porudžbina", icon: PackageCheck },
          ].map((item) => {
            const Icon = item.icon;
            return (
              <div key={item.label} className="flex items-center gap-2">
                <Icon className="size-4 text-walnut" aria-hidden />
                <span>{item.label}</span>
              </div>
            );
          })}
        </div>
      </section>

      <section className="rounded-2xl border border-border/70 bg-surface p-6 shadow-sm md:p-8">
        <h2 className="font-display text-2xl text-ink-900">Kreirajte nalog</h2>
        <p className="mt-1 text-sm text-ink-500">
          Unesite e-poštu i lozinku koju ćete koristiti za prijavu.
        </p>

        <div className="mt-5">
          <RegistrationError error={sp.error} />
        </div>

        <form action={registerAction} className="mt-5">
          <input type="hidden" name="callbackUrl" value={callbackUrl} />
          <CustomerRegistrationFields />
        </form>

        <SocialAuthButtons
          callbackUrl={callbackUrl}
          intent="register"
          providers={socialProviders}
        />

        <p className="mt-6 text-center text-sm text-ink-500">
          Već imate nalog?{" "}
          <Link
            href={loginHref}
            className="font-medium text-walnut hover:underline"
          >
            Prijavite se.
          </Link>
        </p>
        <Link
          href="/"
          className="mt-3 inline-flex w-full justify-center text-sm font-medium text-walnut hover:underline"
        >
          Nazad u prodavnicu
        </Link>
      </section>
    </div>
  );
}
