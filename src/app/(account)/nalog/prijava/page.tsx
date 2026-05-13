import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { CircleUserRound, ShieldCheck } from "lucide-react";
import { CustomerLoginFields, LoginError } from "./form";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getCurrentUser } from "@/lib/auth/session";
import { signIn } from "@/lib/auth/auth";

export const metadata: Metadata = {
  title: "Prijava",
  description: "Prijavite se na svoj Svet Akcija nalog.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

function customerCallback(raw?: string) {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/nalog";
  if (raw.startsWith("/admin")) return "/nalog";
  if (raw.startsWith("/nalog/prijava")) return "/nalog";
  return raw;
}

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
      redirect(
        `/nalog/prijava?error=1&callbackUrl=${encodeURIComponent(callbackUrl)}`,
      );
    }
    throw err;
  }
}

async function googleAction(formData: FormData) {
  "use server";
  await signIn("google", {
    redirectTo: customerCallback(String(formData.get("callbackUrl") ?? "")),
  });
}

async function facebookAction(formData: FormData) {
  "use server";
  await signIn("facebook", {
    redirectTo: customerCallback(String(formData.get("callbackUrl") ?? "")),
  });
}

async function appleAction(formData: FormData) {
  "use server";
  await signIn("apple", {
    redirectTo: customerCallback(String(formData.get("callbackUrl") ?? "")),
  });
}

export default async function CustomerLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; callbackUrl?: string }>;
}) {
  const sp = await searchParams;
  const callbackUrl = customerCallback(sp.callbackUrl);
  const user = await getCurrentUser();

  if (user?.userType === "customer") redirect(callbackUrl);

  const oauth = {
    google: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    facebook: Boolean(
      process.env.FACEBOOK_CLIENT_ID && process.env.FACEBOOK_CLIENT_SECRET,
    ),
    apple: Boolean(process.env.APPLE_CLIENT_ID && process.env.APPLE_CLIENT_SECRET),
  };
  const hasOauth = oauth.google || oauth.facebook || oauth.apple;

  return (
    <div className="mx-auto grid w-full max-w-[var(--container-page)] gap-10 px-4 py-12 md:grid-cols-[minmax(0,1fr)_minmax(360px,440px)] md:px-6 md:py-20">
      <section className="flex flex-col justify-center">
        <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-walnut">
          Moj nalog
        </p>
        <h1 className="font-display mt-3 max-w-xl text-4xl text-ink-900 md:text-6xl">
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
          <LoginError hasError={!!sp.error} />
        </div>

        <form action={loginAction} className="mt-5">
          <input type="hidden" name="callbackUrl" value={callbackUrl} />
          <CustomerLoginFields />
        </form>

        {hasOauth ? (
          <div className="mt-6 space-y-3">
            <div className="flex items-center gap-3 text-xs uppercase tracking-[0.18em] text-ink-400">
              <span className="h-px flex-1 bg-border" />
              ili
              <span className="h-px flex-1 bg-border" />
            </div>
            <div className="grid gap-2">
              {oauth.google ? (
                <form action={googleAction}>
                  <input type="hidden" name="callbackUrl" value={callbackUrl} />
                  <button
                    type="submit"
                    className={cn(
                      buttonVariants({ variant: "outline", size: "lg" }),
                      "h-11 w-full gap-2 bg-white",
                    )}
                  >
                    <CircleUserRound className="size-4" aria-hidden />
                    Google
                  </button>
                </form>
              ) : null}
              {oauth.facebook ? (
                <form action={facebookAction}>
                  <input type="hidden" name="callbackUrl" value={callbackUrl} />
                  <button
                    type="submit"
                    className={cn(
                      buttonVariants({ variant: "outline", size: "lg" }),
                      "h-11 w-full gap-2 bg-white",
                    )}
                  >
                    <CircleUserRound className="size-4" aria-hidden />
                    Facebook
                  </button>
                </form>
              ) : null}
              {oauth.apple ? (
                <form action={appleAction}>
                  <input type="hidden" name="callbackUrl" value={callbackUrl} />
                  <button
                    type="submit"
                    className={cn(
                      buttonVariants({ variant: "outline", size: "lg" }),
                      "h-11 w-full gap-2 bg-white",
                    )}
                  >
                    <CircleUserRound className="size-4" aria-hidden />
                    Apple
                  </button>
                </form>
              ) : null}
            </div>
          </div>
        ) : null}

        <p className="mt-6 text-center text-sm text-ink-500">
          Nemate nalog? Možete nastaviti kupovinu i završiti porudžbinu kao
          gost u checkoutu.
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
