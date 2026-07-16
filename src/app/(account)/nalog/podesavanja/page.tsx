import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { signOut } from "@/lib/auth/auth";
import { requireUser } from "@/lib/auth/session";
import { getProfile, updateProfile } from "@/lib/api/account";
import { setMarketingConsent, softDeleteAccount } from "@/lib/auth/gdpr";
import {
  checkRateLimit,
  getClientIpFromHeaders,
  rateLimitKey,
  RATE_LIMITS,
} from "@/lib/security/rate-limit";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const metadata: Metadata = {
  title: "Podešavanja naloga",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

function optional(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();
  return text || null;
}

async function limitMutation(scope: string, userId: string) {
  const requestHeaders = await headers();
  const limited = await checkRateLimit(
    rateLimitKey(scope, userId, getClientIpFromHeaders(requestHeaders)),
    RATE_LIMITS.accountMutation,
  );
  if (!limited.ok) redirect("/nalog/podesavanja?error=rate_limited");
}

async function updateProfileAction(formData: FormData) {
  "use server";
  const user = await requireUser("/nalog/podesavanja");
  await limitMutation("account-profile", user.id);
  try {
    await updateProfile(user.id, {
      firstName: optional(formData.get("firstName")),
      lastName: optional(formData.get("lastName")),
      phone: optional(formData.get("phone")),
      isBusiness: formData.get("isBusiness") === "on",
      companyName: optional(formData.get("companyName")),
      pib: optional(formData.get("pib")),
      language: formData.get("language") === "sr-Cyrl" ? "sr-Cyrl" : "sr-Latn",
    });
  } catch {
    redirect("/nalog/podesavanja?error=profile");
  }
  redirect("/nalog/podesavanja?saved=profile");
}

async function updateConsentAction(formData: FormData) {
  "use server";
  const user = await requireUser("/nalog/podesavanja");
  await limitMutation("account-consent", user.id);
  await setMarketingConsent(user.id, {
    email: formData.get("email") === "on",
    sms: formData.get("sms") === "on",
    viber: formData.get("viber") === "on",
  });
  redirect("/nalog/podesavanja?saved=consent");
}

async function deleteAccountAction(formData: FormData) {
  "use server";
  const user = await requireUser("/nalog/podesavanja");
  await limitMutation("account-delete", user.id);
  if (String(formData.get("confirmation") ?? "").trim().toUpperCase() !== "OBRIŠI") {
    redirect("/nalog/podesavanja?error=delete_confirmation");
  }
  await softDeleteAccount(user.id);
  await signOut({ redirectTo: "/?account=deleted" });
}

export default async function AccountSettingsPage({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string }> }) {
  const user = await requireUser("/nalog/podesavanja");
  const profile = await getProfile(user.id);
  const status = await searchParams;
  if (!profile) redirect("/nalog/prijava");

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-10 md:px-6 md:py-14">
      <div>
        <Link href="/nalog" className="text-sm text-walnut hover:underline">← Moj nalog</Link>
        <h1 className="font-display mt-2 text-4xl text-ink-900">Podešavanja naloga</h1>
      </div>
      {status.saved ? <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">Izmene su sačuvane.</p> : null}
      {status.error ? <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">Izmena nije sačuvana. Proverite podatke ili pokušajte kasnije.</p> : null}

      <section className="rounded-xl border border-border/70 bg-surface p-5 md:p-7">
        <h2 className="font-display text-2xl">Profil</h2>
        <form action={updateProfileAction} className="mt-5 grid gap-4 sm:grid-cols-2">
          <Field label="Ime" name="firstName" defaultValue={profile.firstName ?? ""} />
          <Field label="Prezime" name="lastName" defaultValue={profile.lastName ?? ""} />
          <Field label="Telefon" name="phone" defaultValue={profile.phone ?? ""} />
          <div className="space-y-2"><Label htmlFor="language">Jezik</Label><select id="language" name="language" defaultValue={profile.language} className="h-10 w-full rounded-lg border border-input bg-white px-3 text-sm"><option value="sr-Latn">Srpski latinica</option><option value="sr-Cyrl">Srpski ćirilica</option></select></div>
          <label className="sm:col-span-2 flex items-center gap-2 text-sm"><input name="isBusiness" type="checkbox" defaultChecked={profile.isBusiness} /> Poslovni kupac</label>
          <Field label="Naziv firme" name="companyName" defaultValue={profile.companyName ?? ""} />
          <Field label="PIB" name="pib" defaultValue={profile.pib ?? ""} />
          <Button type="submit" className="sm:col-span-2 sm:w-fit">Sačuvaj profil</Button>
        </form>
      </section>

      <section className="rounded-xl border border-border/70 bg-surface p-5 md:p-7">
        <h2 className="font-display text-2xl">Marketinške saglasnosti</h2>
        <form action={updateConsentAction} className="mt-4 space-y-3">
          {([['email','E-pošta'],['sms','SMS'],['viber','Viber']] as const).map(([name,label]) => <label key={name} className="flex items-center gap-3 text-sm"><input type="checkbox" name={name} defaultChecked={profile.marketingConsent?.[name] ?? false} /> {label}</label>)}
          <Button type="submit" variant="outline">Sačuvaj saglasnosti</Button>
        </form>
      </section>

      <section className="rounded-xl border border-border/70 bg-surface p-5 md:p-7">
        <h2 className="font-display text-2xl">Privatnost</h2>
        <div className="mt-4 flex flex-wrap gap-3"><a href="/api/account/export" className={cn(buttonVariants({ variant: "outline" }))}>Preuzmi moje podatke</a><Link href="/podesavanja-kolacica" className={cn(buttonVariants({ variant: "outline" }))}>Podešavanja kolačića</Link></div>
      </section>

      <section className="rounded-xl border border-destructive/30 bg-destructive/5 p-5 md:p-7">
        <h2 className="font-display text-2xl text-destructive">Brisanje naloga</h2>
        <p className="mt-2 text-sm text-ink-600">Zakonske evidencije porudžbina i računa ostaju sačuvane u propisanom roku, dok se profil i podaci za prijavu uklanjaju.</p>
        <form action={deleteAccountAction} className="mt-4 flex flex-col gap-3 sm:flex-row"><Input name="confirmation" placeholder="Upišite OBRIŠI" required /><Button type="submit" variant="destructive">Obriši nalog</Button></form>
      </section>
    </div>
  );
}

function Field({ label, name, defaultValue }: { label: string; name: string; defaultValue: string }) {
  return <div className="space-y-2"><Label htmlFor={name}>{label}</Label><Input id={name} name={name} defaultValue={defaultValue} /></div>;
}
