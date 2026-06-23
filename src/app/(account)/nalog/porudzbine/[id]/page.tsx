import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, PackageCheck } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { getOrderForUser } from "@/lib/api/orders";
import { formatRsd } from "@/lib/format";

export const metadata: Metadata = {
  title: "Detalji porudžbine",
  description: "Stavke, status i podaci o isporuci porudžbine.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function AccountOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser(`/nalog/porudzbine/${encodeURIComponent(id)}`);
  const order = await getOrderForUser(user.id, id);
  if (!order) notFound();

  return (
    <main className="mx-auto w-full max-w-[var(--container-page)] px-4 py-10 md:px-6 md:py-14">
      <Link
        href="/nalog/porudzbine"
        className="inline-flex items-center gap-2 text-sm font-medium text-walnut hover:underline"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Sve porudžbine
      </Link>

      <div className="mt-6 flex flex-col gap-4 border-b border-border/70 pb-6 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="font-mono text-sm text-ink-500">{order.number}</p>
          <h1 className="font-display mt-2 text-4xl text-ink-900 md:text-5xl">
            Detalji porudžbine
          </h1>
          <p className="mt-3 text-sm text-ink-600">
            Kreirano{" "}
            {order.createdAt.toLocaleString("sr-Latn-RS", {
              dateStyle: "medium",
              timeStyle: "short",
            })}
          </p>
        </div>
        <StatusPill status={order.status} />
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section className="rounded-lg border border-border/70 bg-surface">
          <div className="border-b border-border/70 px-5 py-4">
            <h2 className="font-display text-2xl text-ink-900">Artikli</h2>
          </div>
          <div className="divide-y divide-border/70">
            {order.items.map((item) => (
              <div key={item.id} className="grid gap-3 px-5 py-4 md:grid-cols-[1fr_auto]">
                <div>
                  <p className="font-medium text-ink-900">{item.name}</p>
                  <p className="mt-1 text-xs text-ink-500">
                    SKU {item.sku} · {item.qty} kom.
                    {item.withAssembly ? " · sa montažom" : ""}
                  </p>
                </div>
                <div className="text-left md:text-right">
                  <p className="font-medium text-ink-900">
                    {formatRsd(item.unitPriceSale * item.qty)}
                  </p>
                  {item.unitPriceFull > item.unitPriceSale ? (
                    <p className="text-xs text-ink-400 line-through">
                      {formatRsd(item.unitPriceFull * item.qty)}
                    </p>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </section>

        <aside className="space-y-4">
          <section className="rounded-lg border border-border/70 bg-surface p-5">
            <h2 className="font-display text-xl text-ink-900">Ukupno</h2>
            <dl className="mt-4 space-y-2 text-sm">
              <Row label="Artikli" value={formatRsd(order.subtotal)} />
              {order.savings > 0 ? (
                <Row label="Ušteda" value={`-${formatRsd(order.savings)}`} />
              ) : null}
              <Row label="Isporuka" value={formatRsd(order.shipping)} />
              {order.assemblyTotal > 0 ? (
                <Row label="Montaža" value={formatRsd(order.assemblyTotal)} />
              ) : null}
              {order.voucherDiscount ? (
                <Row
                  label={`Vaučer ${order.voucherCode ?? ""}`}
                  value={`-${formatRsd(order.voucherDiscount)}`}
                />
              ) : null}
              <div className="border-t border-border/70 pt-3">
                <Row label="Za plaćanje" value={formatRsd(order.total)} strong />
              </div>
            </dl>
          </section>

          <section className="rounded-lg border border-border/70 bg-surface p-5">
            <h2 className="font-display text-xl text-ink-900">Isporuka</h2>
            <p className="mt-3 text-sm leading-relaxed text-ink-700">
              {order.shipFirstName} {order.shipLastName}
              <br />
              {order.shipStreet}
              <br />
              {order.shipPostalCode} {order.shipCity}
              <br />
              {order.shipPhone}
            </p>
            <p className="mt-3 text-xs text-ink-500">
              Metod: {order.shippingMethod}
            </p>
          </section>

          <section className="rounded-lg border border-border/70 bg-surface p-5">
            <h2 className="font-display text-xl text-ink-900">Plaćanje</h2>
            <p className="mt-3 text-sm text-ink-700">{order.paymentMethod}</p>
            {order.payments[0] ? (
              <p className="mt-1 text-xs text-ink-500">
                Status: {order.payments[0].status}
                {order.payments[0].paymentReference
                  ? ` · RP ${order.payments[0].paymentReference}`
                  : ""}
              </p>
            ) : null}
          </section>
        </aside>
      </div>

      <section className="mt-6 rounded-lg border border-border/70 bg-surface p-5">
        <div className="flex items-center gap-2">
          <PackageCheck className="size-5 text-walnut" aria-hidden />
          <h2 className="font-display text-2xl text-ink-900">Statusi</h2>
        </div>
        <div className="mt-4 grid gap-3">
          {order.events.map((event) => (
            <div
              key={event.id}
              className="rounded-lg border border-border/60 bg-canvas px-4 py-3"
            >
              <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
                <p className="text-sm font-medium text-ink-900">
                  {statusLabel(event.status)}
                </p>
                <p className="text-xs text-ink-500">
                  {event.createdAt.toLocaleString("sr-Latn-RS", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </p>
              </div>
              {event.note ? (
                <p className="mt-1 text-sm text-ink-600">{event.note}</p>
              ) : null}
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

function Row({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div
      className={
        strong
          ? "flex items-center justify-between font-semibold text-ink-900"
          : "flex items-center justify-between text-ink-600"
      }
    >
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
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
    <span className={`w-fit rounded-full px-3 py-1 text-xs ${tone}`}>
      {statusLabel(status)}
    </span>
  );
}

function statusLabel(status: string) {
  return status.toLowerCase().replaceAll("_", " ");
}
