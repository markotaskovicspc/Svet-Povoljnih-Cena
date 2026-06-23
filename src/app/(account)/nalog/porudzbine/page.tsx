import type { Metadata } from "next";
import Link from "next/link";
import { PackageCheck, ShoppingBag } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { listOrders } from "@/lib/api/orders";
import { formatRsd } from "@/lib/format";

export const metadata: Metadata = {
  title: "Moje porudžbine",
  description: "Istorija porudžbina i status isporuke.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function AccountOrdersPage() {
  const user = await requireUser("/nalog/porudzbine");
  const orders = await listOrders(user.id);

  return (
    <main className="mx-auto w-full max-w-[var(--container-page)] px-4 py-10 md:px-6 md:py-14">
      <div className="flex flex-col gap-4 border-b border-border/70 pb-6 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-ink-500">
            Moj nalog
          </p>
          <h1 className="font-display mt-2 text-4xl text-ink-900 md:text-5xl">
            Porudžbine
          </h1>
          <p className="mt-3 max-w-[60ch] text-sm leading-relaxed text-ink-600">
            Pregled kupovina, statusa i osnovnih detalja isporuke.
          </p>
        </div>
        <Link
          href="/nalog"
          className="inline-flex items-center rounded-full border border-border px-4 py-2 text-sm font-medium text-ink-900 transition hover:bg-muted-bg"
        >
          Nazad na nalog
        </Link>
      </div>

      {orders.length ? (
        <div className="mt-8 grid gap-3">
          {orders.map((order) => (
            <Link
              key={order.id}
              href={`/nalog/porudzbine/${encodeURIComponent(order.number)}`}
              className="group rounded-lg border border-border/70 bg-surface p-4 transition hover:border-walnut/50 hover:shadow-sm focus-visible:ring-2 focus-visible:ring-walnut/40 focus-visible:outline-none"
            >
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm text-ink-900">
                      {order.number}
                    </span>
                    <StatusPill status={order.status} />
                  </div>
                  <p className="mt-1 text-xs text-ink-500">
                    {order.createdAt.toLocaleString("sr-Latn-RS", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </p>
                  <p className="mt-2 line-clamp-1 text-sm text-ink-600">
                    {order.items.map((item) => `${item.qty} x ${item.name}`).join(", ")}
                  </p>
                </div>
                <div className="flex items-center justify-between gap-4 md:min-w-[220px] md:justify-end">
                  <span className="font-display text-xl text-ink-900">
                    {formatRsd(order.total)}
                  </span>
                  <span className="text-sm font-medium text-walnut group-hover:underline">
                    Detalji
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="mt-8 rounded-lg border border-dashed border-border/80 bg-surface px-6 py-14 text-center">
          <PackageCheck className="mx-auto size-8 text-walnut" aria-hidden />
          <h2 className="font-display mt-4 text-2xl text-ink-900">
            Još nema porudžbina
          </h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-ink-600">
            Kada završite kupovinu kao prijavljeni kupac, porudžbina će se
            pojaviti ovde.
          </p>
          <Link
            href="/akcija"
            className="mt-5 inline-flex items-center gap-2 rounded-full bg-ink-900 px-4 py-2 text-sm font-medium text-canvas transition hover:bg-walnut"
          >
            <ShoppingBag className="size-4" aria-hidden />
            Pogledaj akciju
          </Link>
        </div>
      )}
    </main>
  );
}

function StatusPill({ status }: { status: string }) {
  const tone =
    status === "OTKAZANO" || status === "VRACENO"
      ? "bg-destructive/15 text-destructive"
      : status === "ISPORUCENO"
        ? "bg-success/15 text-success"
        : status === "U_ISPORUCI" || status === "SPREMNO_ZA_ISPORUKU"
          ? "bg-info/15 text-info"
          : "bg-muted-bg text-ink-700";
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] ${tone}`}>
      {statusLabel(status)}
    </span>
  );
}

function statusLabel(status: string) {
  return status.toLowerCase().replaceAll("_", " ");
}
