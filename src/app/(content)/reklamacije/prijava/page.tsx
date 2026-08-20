import type { Metadata } from "next";
import Link from "next/link";
import { ClipboardList } from "lucide-react";
import { ReclamationForm } from "@/app/(account)/nalog/reklamacije/reclamation-form";
import { getGuestOrderForReclamation } from "@/lib/api/reclamations";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Prijava reklamacije",
  description: "Prijavite reklamaciju za kupovinu obavljenu bez naloga.",
  robots: { index: false, follow: false },
};

export default async function GuestReclamationPage({
  searchParams,
}: {
  searchParams: Promise<{ order?: string; token?: string }>;
}) {
  const params = await searchParams;
  const order =
    params.order && params.token
      ? await getGuestOrderForReclamation(params.order, params.token)
      : null;

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10 md:px-6 md:py-14">
      <div className="flex items-start gap-3 border-b border-border/70 pb-6">
        <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-muted-bg text-walnut">
          <ClipboardList className="size-5" aria-hidden />
        </span>
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-ink-500">
            Kupovina bez naloga
          </p>
          <h1 className="font-display mt-2 text-4xl text-ink-900">
            Prijava reklamacije
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-ink-600">
            Bezbedni link iz potvrde porudžbine omogućava prijavu samo za
            artikle koji se nalaze u toj porudžbini.
          </p>
        </div>
      </div>

      <section className="mt-8 rounded-lg border border-border/70 bg-surface p-5">
        {order && params.token ? (
          <ReclamationForm
            guest
            accessToken={params.token}
            orders={[
              {
                number: order.number,
                createdAt: order.createdAt.toISOString(),
                items: order.items,
              },
            ]}
          />
        ) : (
          <div className="py-8 text-center">
            <p className="font-medium text-ink-900">
              Link nije važeći ili više nema artikala za prijavu.
            </p>
            <p className="mt-2 text-sm text-ink-500">
              Otvorite originalni link iz potvrde porudžbine ili kontaktirajte
              podršku.
            </p>
            <Link
              href="/kontakt"
              className="mt-5 inline-flex rounded-full border border-border px-4 py-2 text-sm font-medium text-ink-900"
            >
              Kontakt
            </Link>
          </div>
        )}
      </section>
    </main>
  );
}
