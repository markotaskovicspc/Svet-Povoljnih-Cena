"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  CheckCircle2,
  ClipboardCheck,
  Copy,
  Mail,
  PackageCheck,
  Truck,
  Receipt,
} from "lucide-react";
import { useCheckout } from "@/lib/checkout/store";
import { formatRsd } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Order, PaymentMethod } from "@/types";

/**
 * `/checkout/potvrda` view. Reads the placed order from the checkout store
 * (set during onSubmit in `CheckoutFlow`) and renders payment-specific blocks.
 * If no order is in the store (e.g. direct visit), bounces back to /korpa.
 */
export function ConfirmationView({
  initialOrder,
  paymentStatus,
  paymentMessage,
}: {
  initialOrder?: Order | null;
  paymentStatus?: string;
  paymentMessage?: string;
}) {
  const router = useRouter();
  const storedOrder = useCheckout((s) => s.lastOrder);
  const order = storedOrder ?? initialOrder ?? null;

  useEffect(() => {
    if (!order) router.replace("/korpa");
  }, [order, router]);

  if (!order) return null;

  return (
    <div className="flex flex-col gap-8">
      <SuccessHero order={order} paymentStatus={paymentStatus} />
      <PaymentNotice status={paymentStatus} message={paymentMessage} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex flex-col gap-6">
          <PaymentBlock order={order} />
          <StatusTimeline />
          <NotesBlock order={order} />
        </div>
        <OrderRecap order={order} />
      </div>
      <Ctas />
    </div>
  );
}

function SuccessHero({
  order,
  paymentStatus,
}: {
  order: Order;
  paymentStatus?: string;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(order.id);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore clipboard errors
    }
  };
  return (
    <div className="bg-surface ring-border/60 relative overflow-hidden rounded-2xl p-7 shadow-soft-2 ring-1">
      <div className="bg-olive/5 absolute inset-x-0 top-0 h-24" aria-hidden />
      <div className="relative flex flex-col items-start gap-3">
        <span className="bg-olive/15 text-olive inline-flex size-12 items-center justify-center rounded-full">
          <CheckCircle2 className="size-6" aria-hidden />
        </span>
        <h1 className="font-display text-3xl text-ink-900 md:text-4xl">
          {paymentStatus === "paid" ? "Plaćanje je potvrđeno" : "Hvala vam na porudžbini!"}
        </h1>
        <p className="max-w-prose text-sm text-ink-700">
          Porudžbina je uspešno kreirana. Detalji su poslati i na e-poštu.
          {paymentStatus === "paid"
            ? " Krećemo sa pripremom nakon potvrde operatera."
            : " Status plaćanja možete proveriti na ovoj strani."}
        </p>
        <div className="bg-canvas ring-border/60 mt-1 inline-flex items-center gap-2 rounded-full px-3 py-1.5 ring-1">
          <span className="text-xs text-ink-500">Broj porudžbine</span>
          <span className="font-mono text-sm font-medium text-ink-900">{order.id}</span>
          <button
            type="button"
            onClick={copy}
            className="hover:bg-muted-bg text-ink-700 inline-flex size-7 items-center justify-center rounded-full transition"
            aria-label={copied ? "Kopirano" : "Kopiraj broj porudžbine"}
          >
            {copied ? (
              <ClipboardCheck className="text-success size-3.5" />
            ) : (
              <Copy className="size-3.5" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function PaymentNotice({
  status,
  message,
}: {
  status?: string;
  message?: string;
}) {
  if (!status || status === "paid") return null;

  const failedText =
    "IPS Plaćanje nije uspešno, vaš račun nije zadužen. Možete pokušati ponovo generisanjem novog IPS QR koda";
  const copy =
    status === "failed"
      ? failedText
      : status === "cancel"
        ? "Plaćanje je otkazano. Možete promeniti način plaćanja ili pokrenuti novi pokušaj."
        : status === "checking"
          ? "Proveravamo status plaćanja. Ako ste već potvrdili nalog u banci, osvežite stranicu za nekoliko trenutaka."
          : message ?? "Status plaćanja trenutno nije moguće potvrditi.";

  return (
    <div className="border-border/60 bg-surface flex items-start gap-3 rounded-2xl p-4 ring-1">
      <span className="bg-muted-bg text-ink-700 inline-flex size-9 shrink-0 items-center justify-center rounded-xl">
        <AlertCircle className="size-4" aria-hidden />
      </span>
      <p className="text-sm text-ink-700">{copy}</p>
    </div>
  );
}

function PaymentBlock({ order }: { order: Order }) {
  return (
    <section className="bg-surface ring-border/60 rounded-2xl p-5 ring-1">
      <h2 className="font-display text-lg text-ink-900">Plaćanje</h2>
      <div className="mt-4">
        <PaymentMethodView order={order} method={order.paymentMethod} />
      </div>
    </section>
  );
}

function PaymentMethodView({
  order,
  method,
}: {
  order: Order;
  method: PaymentMethod;
}) {
  if (method === "ips") {
    const startUrl = `/api/payment/ips/start/${encodeURIComponent(order.id)}`;
    const statusUrl = `/api/payment/ips/status/${encodeURIComponent(order.id)}`;
    return (
      <div className="bg-canvas ring-border/60 flex flex-col gap-3 rounded-xl p-5 ring-1">
        <p className="text-ink-900 font-medium">IPS Skeniraj</p>
        <p className="text-sm text-ink-700">
          Plaćanje se pokreće na Payten strani banke, gde se prikazuje IPS QR kod
          ili deep link za m-banking aplikaciju.
        </p>
        <DetailRow label="Iznos" value={formatRsd(order.total)} mono />
        <DetailRow label="Broj porudžbine" value={order.id} mono />
        {order.payment?.paymentReference ? (
          <DetailRow label="RP referenca" value={order.payment.paymentReference} mono />
        ) : null}
        <div className="mt-2 flex flex-wrap gap-2">
          <a
            href={startUrl}
            className="bg-ink-900 hover:bg-walnut focus-visible:ring-walnut/40 inline-flex w-fit items-center rounded-full px-4 py-2 text-sm font-medium text-canvas transition focus-visible:ring-2 focus-visible:outline-none"
          >
            Generiši IPS QR kod
          </a>
          <a
            href={statusUrl}
            className="ring-border/60 hover:bg-muted-bg focus-visible:ring-walnut/40 inline-flex w-fit items-center rounded-full px-4 py-2 text-sm font-medium text-ink-900 ring-1 transition focus-visible:ring-2 focus-visible:outline-none"
          >
            Proveri status
          </a>
        </div>
      </div>
    );
  }

  if (method === "uplata_na_racun") {
    return (
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
        <Uplatnica order={order} />
        <div className="flex flex-col gap-2 text-sm text-ink-700">
          <p className="text-ink-900 font-medium">Uplata na račun</p>
          <p>
            Sačuvajte uplatnicu, izvršite prenos sa svog tekućeg računa i
            sačekajte našu potvrdu prijema. Kada potvrdimo uplatu, kreće
            priprema porudžbine.
          </p>
          <DetailRow label="IBAN" value="RS35 2651 0000 0000 0000 00" mono />
          <DetailRow label="Iznos" value={formatRsd(order.total)} mono />
          <DetailRow label="Poziv na broj" value={order.id} mono />
        </div>
      </div>
    );
  }

  if (method === "kartica" || method === "google_pay" || method === "apple_pay") {
    const startUrl = `/api/payment/wspay/start/${encodeURIComponent(order.id)}`;
    return (
      <div className="bg-canvas ring-border/60 flex flex-col gap-3 rounded-xl p-5 ring-1">
        <p className="text-ink-900 text-sm font-medium">
          Preusmeravanje na sigurno plaćanje
        </p>
        <p className="text-sm text-ink-700">
          U sledećem koraku otvoriće se WSPay strana sa 3-D Secure
          validacijom. Po završetku se vraćate ovde sa potvrdom uplate.
        </p>
        <div className="bg-muted-bg/60 flex items-center justify-between rounded-lg px-3 py-2">
          <span className="text-xs text-ink-500">Iznos</span>
          <span className="text-ink-900 font-mono text-sm font-medium">
            {formatRsd(order.total)}
          </span>
        </div>
        <a
          href={startUrl}
          className="bg-ink-900 hover:bg-walnut focus-visible:ring-walnut/40 inline-flex w-fit items-center rounded-full px-4 py-2 text-sm font-medium text-canvas transition focus-visible:ring-2 focus-visible:outline-none"
        >
          Nastavi na WSPay
        </a>
      </div>
    );
  }

  if (method === "pouzece_gotovina" || method === "pouzece_kartica") {
    return (
      <div className="bg-canvas ring-border/60 flex flex-col gap-2 rounded-xl p-5 ring-1 text-sm text-ink-700">
        <p className="text-ink-900 font-medium">
          Plaćanje pouzećem ({method === "pouzece_kartica" ? "kartica" : "gotovina"})
        </p>
        <p>
          Iznos plaćate kuriru pri preuzimanju pošiljke. Pripremite{" "}
          <span className="text-ink-900 font-mono">{formatRsd(order.total)}</span>
          {method === "pouzece_kartica"
            ? " — kuriri imaju POS terminale za karticu."
            : " u gotovini."}
        </p>
      </div>
    );
  }

  return null;
}

function DetailRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-xs text-ink-500">{label}</span>
      <span
        className={cn(
          "text-ink-900 text-sm font-medium tabular-nums",
          mono && "font-mono",
        )}
      >
        {value}
      </span>
    </div>
  );
}

function Uplatnica({ order }: { order: Order }) {
  // Simplified Serbian uplatnica — for visual cue. Real PDF render lands in
  // Phase 4 (server-side PDFKit / @react-pdf).
  return (
    <div className="bg-canvas ring-border/60 grid grid-cols-[1fr_auto] gap-3 rounded-xl p-4 ring-1 font-mono text-[11px]">
      <div className="flex flex-col gap-1.5">
        <span className="text-ink-500">UPLATILAC</span>
        <span className="text-ink-900">
          {order.shippingAddress.firstName} {order.shippingAddress.lastName}
          <br />
          {order.shippingAddress.street}
          <br />
          {order.shippingAddress.postalCode} {order.shippingAddress.city}
        </span>
        <span className="mt-2 text-ink-500">SVRHA UPLATE</span>
        <span className="text-ink-900">Porudžbina {order.id}</span>
        <span className="mt-2 text-ink-500">PRIMALAC</span>
        <span className="text-ink-900">
          Svet Akcija d.o.o.
          <br />
          Beograd, Srbija
        </span>
      </div>
      <div className="border-border/60 flex flex-col gap-1.5 border-l pl-3">
        <span className="text-ink-500">ŠIFRA PLAĆANJA</span>
        <span className="text-ink-900">189</span>
        <span className="text-ink-500">VALUTA</span>
        <span className="text-ink-900">RSD</span>
        <span className="text-ink-500">IZNOS</span>
        <span className="text-ink-900 text-base">{formatRsd(order.total)}</span>
        <span className="text-ink-500">RAČUN PRIMAOCA</span>
        <span className="text-ink-900">265-1000000000000-00</span>
        <span className="text-ink-500">POZIV NA BROJ</span>
        <span className="text-ink-900">{order.id}</span>
      </div>
    </div>
  );
}

function StatusTimeline() {
  const steps = [
    { id: "created", label: "Kreirano", icon: Receipt, done: true },
    { id: "prep", label: "Priprema", icon: PackageCheck, done: false },
    { id: "ship", label: "U isporuci", icon: Truck, done: false },
    { id: "delivered", label: "Isporučeno", icon: CheckCircle2, done: false },
  ];
  return (
    <section className="bg-surface ring-border/60 rounded-2xl p-5 ring-1">
      <h2 className="font-display text-lg text-ink-900">Šta dalje</h2>
      <ol className="mt-4 grid gap-3 sm:grid-cols-4">
        {steps.map((s, i) => {
          const Icon = s.icon;
          return (
            <li
              key={s.id}
              className={cn(
                "ring-border/60 bg-canvas flex flex-col items-start gap-2 rounded-xl p-3 ring-1",
                s.done && "ring-walnut/60 bg-walnut/5",
              )}
            >
              <span
                className={cn(
                  "inline-flex size-8 items-center justify-center rounded-lg",
                  s.done ? "bg-walnut text-canvas" : "bg-muted-bg text-ink-700",
                )}
                aria-hidden
              >
                <Icon className="size-4" />
              </span>
              <p className="text-xs text-ink-500">Korak {i + 1}</p>
              <p className="text-sm font-medium text-ink-900">{s.label}</p>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function NotesBlock({ order }: { order: Order }) {
  if (!order.notes?.trim()) return null;
  return (
    <section className="bg-surface ring-border/60 rounded-2xl p-5 ring-1">
      <h2 className="font-display text-lg text-ink-900">Vaše napomene</h2>
      <p className="mt-2 text-sm whitespace-pre-line text-ink-700">{order.notes}</p>
    </section>
  );
}

function OrderRecap({ order }: { order: Order }) {
  return (
    <aside className="bg-surface ring-border/60 lg:sticky lg:top-28 lg:self-start flex flex-col gap-3 rounded-2xl p-5 ring-1">
      <h2 className="font-display text-lg text-ink-900">Sažetak</h2>
      <ul className="divide-border/60 max-h-72 divide-y overflow-y-auto pr-1">
        {order.items.map((it) => (
          <li
            key={it.sku}
            className="flex items-center justify-between gap-3 py-2 text-sm"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-ink-900">{it.name}</p>
              <p className="text-[11px] text-ink-500 tabular-nums">
                {it.qty} × {formatRsd(it.unitPriceSale)}
                {it.withAssembly ? " + montaža" : ""}
              </p>
            </div>
            <span className="text-xs font-medium text-ink-900 tabular-nums">
              {formatRsd(it.unitPriceSale * it.qty)}
            </span>
          </li>
        ))}
      </ul>
      <dl className="border-border/60 flex flex-col gap-1.5 border-t pt-3 text-sm">
        <Row label="Artikli" value={formatRsd(order.subtotal)} />
        {order.savings > 0 ? (
          <Row label="Ušteda" value={`−${formatRsd(order.savings)}`} action />
        ) : null}
        <Row label="Isporuka" value={formatRsd(order.shipping)} />
        {order.assemblyTotal > 0 ? (
          <Row label="Montaža" value={formatRsd(order.assemblyTotal)} />
        ) : null}
        {order.voucherDiscount && order.voucherCode ? (
          <Row
            label={`Vaučer „${order.voucherCode}"`}
            value={`−${formatRsd(order.voucherDiscount)}`}
            action
          />
        ) : null}
      </dl>
      <div className="border-border/60 flex items-baseline justify-between border-t pt-3">
        <span className="text-sm font-medium text-ink-900">Ukupno</span>
        <span className="font-display text-2xl text-ink-900">
          {formatRsd(order.total)}
        </span>
      </div>
      {order.payment ? (
        <dl className="border-border/60 flex flex-col gap-1.5 border-t pt-3 text-sm">
          <Row label="Status plaćanja" value={paymentStatusLabel(order.payment.status)} />
          {order.payment.paymentReference ? (
            <Row label="RP referenca" value={order.payment.paymentReference} />
          ) : null}
          {order.payment.paidAt ? (
            <Row
              label="Datum uplate"
              value={new Intl.DateTimeFormat("sr-Latn-RS", {
                dateStyle: "medium",
                timeStyle: "short",
              }).format(new Date(order.payment.paidAt))}
            />
          ) : null}
        </dl>
      ) : null}
      <p className="text-[11px] text-ink-500">
        PDV je uključen u cenu. Račun trgovca: 160-000000-00.
      </p>
      <p className="border-border/60 inline-flex items-center gap-1.5 border-t pt-3 text-[11px] text-ink-500">
        <Mail className="size-3.5" aria-hidden />
        Detalji su poslati na e-poštu.
      </p>
    </aside>
  );
}

const Row = ({
  label,
  value,
  action,
}: {
  label: string;
  value: string;
  action?: boolean;
}) => (
  <div className="flex items-baseline justify-between">
    <dt className="text-ink-700">{label}</dt>
    <dd
      className={cn(
        "tabular-nums",
        action ? "text-action font-semibold" : "font-medium text-ink-900",
      )}
    >
      {value}
    </dd>
  </div>
);

function paymentStatusLabel(status: NonNullable<Order["payment"]>["status"]) {
  switch (status) {
    case "paid":
      return "Izvršeno";
    case "failed":
      return "Neizvršeno";
    case "refunded":
      return "Refundirano";
    case "partial_refund":
      return "Delimično refundirano";
    case "authorized":
      return "Autorizovano";
    case "pending":
    default:
      return "U obradi";
  }
}

function Ctas() {
  return (
    <div className="flex flex-wrap items-center justify-center gap-3">
      <Link
        href="/"
        className="ring-border/60 hover:bg-muted-bg focus-visible:ring-walnut/40 inline-flex items-center rounded-full px-4 py-2.5 text-sm font-medium text-ink-900 ring-1 transition focus-visible:ring-2 focus-visible:outline-none"
      >
        Nastavi kupovinu
      </Link>
      <Link
        href="/nalog"
        className="bg-ink-900 hover:bg-walnut focus-visible:ring-walnut/40 inline-flex items-center rounded-full px-4 py-2.5 text-sm font-medium text-canvas transition focus-visible:ring-2 focus-visible:outline-none"
      >
        Pregled mog naloga
      </Link>
    </div>
  );
}
