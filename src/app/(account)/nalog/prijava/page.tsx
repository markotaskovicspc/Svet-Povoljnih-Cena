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

export const metadata: Metadata = {
  title: "Prijava",
  description: "Prijavite se na svoj Svet Akcija nalog.",
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
    <div className="mx-auto grid w-full max-w-[var(--container-page)] gap-10 px-4 py-12 md:grid-cols-[minmax(0,1fr)_minmax(360px,440px)] md:px-6 md:py-20">
      <section className="flex flex-col justify-center">
        <h1 className="font-display max-w-xl text-4xl text-ink-900 md:text-6xl">
          Prijava za bržu kupovinu
        </h1>
        <p className="mt-5 max-w-[58ch] text-base leading-relaxed text-ink-600 md:text-lg">
          Sačuvajte listu želja, pratite porudžbine i nastavite kupovinu tamo
          gde ste stali.
        </p>
        <div className="mt-8 grid gap-3 text-sm text-ink-700 sm:grid-cols-2">
          {[
            "Sačuvani favoriti",
            "Brža sledeća porudžbina",
            "Status isporuke",
            "Posebne ponude za nalog",
          ].map((item) => (
            <div key={item} className="flex items-center gap-2">
              <ShieldCheck className="size-4 text-walnut" aria-hidden />
              <span>{item}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-border/70 bg-surface p-6 shadow-sm md:p-8">
        <h2 className="font-display text-2xl text-ink-900">Prijavite se</h2>
        <p className="mt-1 text-sm text-ink-500">
          Koristite e-poštu i lozinku za svoj korisnički nalog.
        </p>

        <div className="mt-5">
          <LoginError error={sp.error} />
        </div>

        <form action={loginAction} className="mt-5">
          <input type="hidden" name="callbackUrl" value={callbackUrl} />
          <CustomerLoginFields />
        </form>

        <SocialAuthButtons
          callbackUrl={callbackUrl}
          intent="login"
          providers={socialProviders}
        />

        <p className="mt-6 text-center text-sm text-ink-500">
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
          className="mt-3 inline-flex w-full justify-center text-sm font-medium text-walnut hover:underline"
        >
          Nazad u prodavnicu
        </Link>
      </section>
    </div>
  );
}
