import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { consumePasswordResetToken } from "@/lib/auth/credentials";
import {
  checkRateLimit,
  getClientIpFromHeaders,
  rateLimitKey,
  RATE_LIMITS,
} from "@/lib/security/rate-limit";
import { NewPasswordFields } from "./form";

export const metadata: Metadata = {
  title: "Nova lozinka",
  robots: { index: false, follow: false },
};

async function resetPassword(formData: FormData) {
  "use server";
  const token = String(formData.get("token") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirmation = String(formData.get("confirmPassword") ?? "");
  if (!token || password.length < 8 || password.length > 200 || password !== confirmation) {
    redirect(`/nalog/lozinka/nova?token=${encodeURIComponent(token)}&error=invalid`);
  }
  const requestHeaders = await headers();
  const limited = await checkRateLimit(
    rateLimitKey("password-reset-consume", getClientIpFromHeaders(requestHeaders), token),
    RATE_LIMITS.passwordReset,
  );
  if (!limited.ok) redirect("/nalog/lozinka/nova?error=rate_limited");
  const changed = await consumePasswordResetToken(token, password);
  if (!changed) redirect("/nalog/lozinka/nova?error=expired");
  redirect("/nalog/prijava?reset=success");
}

export default async function NewPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string; error?: string }> }) {
  const { token = "", error } = await searchParams;
  return (
    <div className="mx-auto w-full max-w-lg px-4 py-12 md:py-20">
      <section className="rounded-2xl border border-border/70 bg-surface p-6 shadow-sm md:p-8">
        <h1 className="font-display text-3xl text-ink-900">Nova lozinka</h1>
        <p className="mt-2 text-sm text-ink-600">Link je jednokratan i važi 60 minuta.</p>
        {error ? (
          <p role="alert" className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            {error === "expired" ? "Link nije važeći ili je istekao. Zatražite novi." : error === "rate_limited" ? "Previše pokušaja. Pokušajte kasnije." : "Lozinke moraju biti jednake i imati najmanje 8 karaktera."}
          </p>
        ) : null}
        {token ? (
          <form action={resetPassword} className="mt-6">
            <input type="hidden" name="token" value={token} />
            <NewPasswordFields />
          </form>
        ) : (
          <Link href="/nalog/lozinka/zaboravljena" className="mt-6 inline-flex font-medium text-walnut hover:underline">
            Zatražite novi link
          </Link>
        )}
      </section>
    </div>
  );
}
