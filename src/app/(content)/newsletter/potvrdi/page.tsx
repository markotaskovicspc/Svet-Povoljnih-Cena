import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { confirmNewsletterOptIn } from "@/lib/newsletter/contacts";
import { NewsletterConfirmation } from "@/components/newsletter/confirmation";

export const metadata: Metadata = { title: "Potvrda newsletter prijave", robots: { index: false, follow: false }, referrer: "no-referrer" };
export const dynamic = "force-dynamic";

async function confirm(token: string) {
  "use server";
  const result = await confirmNewsletterOptIn(token);
  return { ok: result.ok, reason: result.ok ? undefined : result.reason };
}
async function fallback(form: FormData) {
  "use server";
  const result = await confirm(String(form.get("token") ?? ""));
  redirect(`/newsletter/potvrdi?status=${result.ok ? "success" : result.reason}`);
}
export default async function NewsletterConfirmPage({ searchParams }: { searchParams: Promise<{ token?: string; status?: string }> }) {
  const { token, status } = await searchParams;
  return <>
    <NewsletterConfirmation key={token ?? status} token={token ?? ""} status={status} confirm={confirm} />
    {token && <noscript><form action={fallback} className="mx-auto max-w-xl p-6 text-center"><input type="hidden" name="token" value={token} /><p>JavaScript je isključen. Završite prijavu ovim dugmetom.</p><button type="submit" className="mt-4 rounded-full bg-ink-900 px-6 py-3 text-white">Potvrdi prijavu</button></form></noscript>}
  </>;
}
