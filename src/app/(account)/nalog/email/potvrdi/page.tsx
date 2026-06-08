import type { Metadata } from "next";
import Link from "next/link";
import { MailCheck, MailX } from "lucide-react";
import { consumeEmailConfirmationToken } from "@/lib/auth/credentials";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Potvrda e-pošte",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function ConfirmEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const sp = await searchParams;
  const token = sp.token?.trim() ?? "";
  const result = token
    ? await consumeEmailConfirmationToken(token)
    : { ok: false as const, reason: "invalid" as const };
  const ok = result.ok;
  const Icon = ok ? MailCheck : MailX;

  return (
    <div className="mx-auto flex min-h-[60vh] w-full max-w-xl flex-col items-center justify-center px-4 py-16 text-center">
      <span
        className={cn(
          "inline-flex size-14 items-center justify-center rounded-2xl",
          ok ? "bg-success/15 text-success" : "bg-destructive/10 text-destructive",
        )}
      >
        <Icon className="size-7" aria-hidden />
      </span>
      <h1 className="font-display mt-5 text-3xl text-ink-900">
        {ok ? "E-pošta je potvrđena" : "Link nije važeći"}
      </h1>
      <p className="mt-3 text-sm leading-relaxed text-ink-600">
        {ok
          ? "Hvala vam. Vaš nalog je sada označen kao potvrđen."
          : result.reason === "expired"
            ? "Ovaj link je istekao. Prijavite se na nalog i pošaljite novi link za potvrdu."
            : "Link za potvrdu nije ispravan ili je već iskorišćen."}
      </p>
      <Link
        href="/nalog"
        className={cn(buttonVariants({ variant: "default", size: "lg" }), "mt-6")}
      >
        Otvori nalog
      </Link>
    </div>
  );
}
