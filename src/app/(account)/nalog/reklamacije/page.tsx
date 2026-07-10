import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { ClipboardList } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { listOrders } from "@/lib/api/orders";
import { listReclamationsForUser } from "@/lib/api/reclamations";
import { db } from "@/lib/db";
import { ReclamationForm } from "./reclamation-form";

export const metadata: Metadata = {
  title: "Reklamacije",
  description: "Prijavite reklamaciju i pratite status postojećih.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const STATUS_LABELS: Record<string, string> = {
  PRIMLJENO: "Primljena",
  U_OBRADI: "U obradi",
  RESENO: "Rešena",
  ODBIJENO: "Odbijena",
};

const STATUS_TONE: Record<string, string> = {
  PRIMLJENO: "bg-info/15 text-info",
  U_OBRADI: "bg-muted-bg text-ink-700",
  RESENO: "bg-success/15 text-success",
  ODBIJENO: "bg-destructive/15 text-destructive",
};

export default async function AccountReclamationsPage() {
  const user = await requireUser("/nalog/reklamacije");
  const [reclamations, orders, account] = await Promise.all([
    listReclamationsForUser(user.id),
    listOrders(user.id),
    db.user.findUnique({
      where: { id: user.id },
      select: { firstName: true, lastName: true, name: true, email: true, phone: true },
    }),
  ]);

  const [fallbackFirst, ...fallbackLastParts] = (account?.name ?? "").split(" ");
  const defaults = {
    firstName: account?.firstName ?? fallbackFirst ?? "",
    lastName: account?.lastName ?? fallbackLastParts.join(" "),
    email: account?.email ?? "",
    phone: account?.phone ?? "",
  };

  const orderOptions = orders.map((order) => ({
    number: order.number,
    createdAt: order.createdAt.toISOString(),
    items: order.items.map((item) => ({
      sku: item.sku,
      name: item.name,
      qty: item.qty,
    })),
  }));

  return (
    <main className="mx-auto w-full max-w-[var(--container-page)] px-4 py-10 md:px-6 md:py-14">
      <div className="flex flex-col gap-4 border-b border-border/70 pb-6 md:flex-row md:items-end md:justify-between">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-lg bg-muted-bg text-walnut">
            <ClipboardList className="size-5" aria-hidden />
          </span>
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-ink-500">
              Moj nalog
            </p>
            <h1 className="font-display mt-2 text-4xl text-ink-900 md:text-5xl">
              Reklamacije
            </h1>
            <p className="mt-3 max-w-[60ch] text-sm leading-relaxed text-ink-600">
              Prijavite reklamaciju za artikal iz porudžbine i pratite status
              rešavanja.
            </p>
          </div>
        </div>
        <Link
          href="/nalog"
          className="inline-flex items-center rounded-full border border-border px-4 py-2 text-sm font-medium text-ink-900 transition hover:bg-muted-bg"
        >
          Nazad na nalog
        </Link>
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <section className="rounded-lg border border-border/70 bg-surface p-5 lg:order-2">
          <h2 className="font-display text-2xl text-ink-900">Nova reklamacija</h2>
          {orderOptions.length ? (
            <ReclamationForm orders={orderOptions} defaults={defaults} />
          ) : (
            <div className="mt-5 rounded-lg border border-dashed border-border bg-muted-bg/40 px-5 py-10 text-center">
              <ClipboardList className="mx-auto size-8 text-ink-300" aria-hidden />
              <p className="mt-3 font-medium text-ink-900">
                Nemate porudžbina za reklamaciju
              </p>
              <p className="mt-1 text-sm text-ink-500">
                Reklamaciju možete podneti tek nakon prve kupovine na sajtu.
              </p>
            </div>
          )}
        </section>

        <section className="rounded-lg border border-border/70 bg-surface p-5 lg:order-1">
          <h2 className="font-display text-2xl text-ink-900">Vaše reklamacije</h2>
          {reclamations.length ? (
            <div className="mt-5 grid gap-3">
              {reclamations.map((r) => (
                <article
                  key={r.id}
                  className="rounded-lg border border-border/70 bg-white p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-sm text-ink-900">
                          {r.number}
                        </span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[11px] ${STATUS_TONE[r.status] ?? "bg-muted-bg text-ink-700"}`}
                        >
                          {STATUS_LABELS[r.status] ?? r.status}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-ink-500">
                        {r.createdAt.toLocaleString("sr-Latn-RS", {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                      </p>
                      <p className="mt-2 text-sm leading-relaxed text-ink-700">
                        {r.description}
                      </p>
                      {r.photos.length ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {r.photos.map((photo) => (
                            <a
                              key={photo.id}
                              href={photo.url}
                              target="_blank"
                              rel="noreferrer"
                              className="relative block size-16 overflow-hidden rounded-md border border-border/60"
                            >
                              <Image
                                src={photo.url}
                                alt=""
                                fill
                                sizes="64px"
                                className="object-cover"
                              />
                            </a>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="mt-5 rounded-lg border border-dashed border-border bg-muted-bg/40 px-5 py-10 text-center">
              <ClipboardList className="mx-auto size-8 text-ink-300" aria-hidden />
              <p className="mt-3 font-medium text-ink-900">Još nema reklamacija</p>
              <p className="mt-1 text-sm text-ink-500">
                Prijavljene reklamacije i njihov status pojaviće se ovde.
              </p>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
