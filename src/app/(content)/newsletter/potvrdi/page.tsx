import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { MailCheck, MailX } from "lucide-react";
import { confirmNewsletterOptIn } from "@/lib/newsletter/contacts";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Potvrda newsletter prijave",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

async function confirmAction(formData: FormData) {
  "use server";
  const token = String(formData.get("token") ?? "").trim();
  const result = await confirmNewsletterOptIn(token);
  redirect(`/newsletter/potvrdi?status=${result.ok ? "success" : result.reason}`);
}

export default async function NewsletterConfirmPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; status?: string }>;
}) {
  const sp = await searchParams;
  const status = sp.status;
  const success = status === "success";
  const failed = Boolean(status && !success);
  const Icon = success ? MailCheck : failed ? MailX : MailCheck;

  return (
    <div className="mx-auto flex min-h-[60vh] w-full max-w-xl flex-col items-center justify-center px-4 py-16 text-center">
      <span className={`inline-flex size-14 items-center justify-center rounded-2xl ${failed ? "bg-destructive/10 text-destructive" : "bg-success/15 text-success"}`}>
        <Icon className="size-7" aria-hidden />
      </span>
      <h1 className="font-display mt-5 text-3xl text-ink-900">
        {success ? "Newsletter prijava je potvrđena" : failed ? "Link nije važeći" : "Potvrdite newsletter prijavu"}
      </h1>
      <p className="mt-3 text-sm leading-relaxed text-ink-600">
        {success
          ? "Hvala vam. Od sada možete da primate akcije, kupone i najbolje ponude."
          : failed
            ? status === "expired" ? "Link je istekao. Prijavite se ponovo preko newsletter forme." : "Link nije ispravan, već je iskorišćen ili adresa ne može da prima poruke."
            : "Kliknite na dugme ispod da završite prijavu. Bez ove potvrde promotivni mejlovi neće biti poslati."}
      </p>
      {!status && sp.token ? (
        <form action={confirmAction} className="mt-6">
          <input type="hidden" name="token" value={sp.token} />
          <Button type="submit" size="lg">Potvrdi prijavu</Button>
        </form>
      ) : null}
    </div>
  );
}
