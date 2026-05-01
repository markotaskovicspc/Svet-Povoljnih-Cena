"use client";

import Image from "next/image";
import { Loader2, ShieldCheck, Truck, Wrench } from "lucide-react";
import { useCart } from "@/lib/hooks/use-cart";
import {
  ASSEMBLY_PRICE_DEFAULT,
  PAYMENT_LABELS,
  SHIPPING_PRICES,
  useCheckout,
} from "@/lib/checkout/store";
import { formatRsd } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { PaymentMethod, ShippingMethod, SKU } from "@/types";

export interface SummaryTotals {
  itemsFull: number;
  itemsSale: number;
  savings: number;
  shipping: number;
  assembly: number;
  voucherDiscount: number;
  total: number;
}

export function computeTotals({
  itemsFull,
  itemsSale,
  shippingMethod,
  assemblyTotal,
  voucherFraction,
}: {
  itemsFull: number;
  itemsSale: number;
  shippingMethod: ShippingMethod;
  assemblyTotal: number;
  voucherFraction: number;
}): SummaryTotals {
  const shipping = SHIPPING_PRICES[shippingMethod];
  const voucherDiscount = Math.round(itemsSale * voucherFraction);
  const total = itemsSale + shipping + assemblyTotal - voucherDiscount;
  return {
    itemsFull,
    itemsSale,
    savings: itemsFull - itemsSale,
    shipping,
    assembly: assemblyTotal,
    voucherDiscount,
    total: Math.max(0, total),
  };
}

interface OrderSummaryProps {
  shippingMethod: ShippingMethod;
  paymentMethod?: PaymentMethod | null;
  perItemAssembly?: Record<SKU, boolean>;
  /** Optional CTA appended at the bottom (used by the final review state). */
  cta?: React.ReactNode;
  /** Hide the cart-line list; useful on confirmation page. */
  collapseLines?: boolean;
}

export function OrderSummary({
  shippingMethod,
  paymentMethod,
  perItemAssembly,
  cta,
  collapseLines,
}: OrderSummaryProps) {
  const hydrated = useCart((s) => s.hydrated);
  const lines = useCart((s) => s.lines);
  const voucher = useCheckout((s) => s.voucher);

  const itemsFull = lines.reduce((n, l) => n + l.unitPriceFull * l.qty, 0);
  const itemsSale = lines.reduce((n, l) => n + l.unitPriceSale * l.qty, 0);
  const assemblyTotal =
    shippingMethod === "kamion" && perItemAssembly
      ? lines.reduce(
          (n, l) =>
            n + (perItemAssembly[l.sku] ? ASSEMBLY_PRICE_DEFAULT * l.qty : 0),
          0,
        )
      : 0;

  const totals = computeTotals({
    itemsFull,
    itemsSale,
    shippingMethod,
    assemblyTotal,
    voucherFraction: voucher?.amount ?? 0,
  });

  return (
    <aside
      aria-label="Sažetak porudžbine"
      className="lg:sticky lg:top-28 lg:self-start"
    >
      <div className="bg-surface ring-border/60 flex flex-col gap-4 rounded-2xl p-5 shadow-soft-2 ring-1">
        <h2 className="font-display text-lg text-ink-900">Sažetak porudžbine</h2>

        {!hydrated ? (
          <div className="flex h-24 items-center justify-center text-ink-500">
            <Loader2 className="size-4 animate-spin" aria-hidden />
          </div>
        ) : !collapseLines ? (
          <ul className="divide-border/60 max-h-72 divide-y overflow-y-auto pr-1">
            {lines.map((l) => (
              <li
                key={l.sku}
                className="grid grid-cols-[44px_1fr_auto] items-center gap-3 py-3"
              >
                <span className="bg-muted-bg ring-border/60 relative block size-11 overflow-hidden rounded-lg ring-1">
                  {l.thumbnailUrl ? (
                    <Image
                      src={l.thumbnailUrl}
                      alt=""
                      fill
                      sizes="44px"
                      className="object-cover"
                    />
                  ) : null}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-xs text-ink-900">{l.name}</p>
                  <p className="text-[11px] text-ink-500 tabular-nums">
                    {l.qty} × {formatRsd(l.unitPriceSale)}
                  </p>
                </div>
                <span className="text-xs font-medium text-ink-900 tabular-nums">
                  {formatRsd(l.unitPriceSale * l.qty)}
                </span>
              </li>
            ))}
          </ul>
        ) : null}

        <dl className="border-border/60 flex flex-col gap-1.5 border-t pt-3 text-sm">
          <Row label="Vrednost artikala" value={formatRsd(totals.itemsFull)} />
          {totals.savings > 0 ? (
            <Row
              label="Ušteda"
              value={`−${formatRsd(totals.savings)}`}
              tone="action"
            />
          ) : null}
          <Row
            label={
              <span className="inline-flex items-center gap-1.5">
                <Truck className="size-3.5" aria-hidden />
                Isporuka — {shippingMethod === "kurir" ? "kurir" : "kamion"}
              </span>
            }
            value={formatRsd(totals.shipping)}
          />
          {totals.assembly > 0 ? (
            <Row
              label={
                <span className="inline-flex items-center gap-1.5">
                  <Wrench className="size-3.5" aria-hidden />
                  Montaža
                </span>
              }
              value={formatRsd(totals.assembly)}
            />
          ) : null}
          {totals.voucherDiscount > 0 && voucher ? (
            <Row
              label={`Vaučer „${voucher.code}"`}
              value={`−${formatRsd(totals.voucherDiscount)}`}
              tone="action"
            />
          ) : null}
        </dl>

        <div className="border-border/60 flex items-baseline justify-between border-t pt-3">
          <span className="text-sm font-medium text-ink-900">
            Ukupno za plaćanje
          </span>
          <span className="font-display text-2xl text-ink-900">
            {formatRsd(totals.total)}
          </span>
        </div>

        {paymentMethod ? (
          <p className="text-[11px] text-ink-500">
            Način plaćanja: {PAYMENT_LABELS[paymentMethod]}
          </p>
        ) : null}

        {cta}

        <p className="border-border/60 inline-flex items-center gap-1.5 border-t pt-3 text-[11px] text-ink-500">
          <ShieldCheck className="size-3.5" aria-hidden />
          Sigurna naplata · 256-bit TLS · WSPay 3-D Secure
        </p>
      </div>
    </aside>
  );
}

const Row = ({
  label,
  value,
  tone = "default",
}: {
  label: React.ReactNode;
  value: string;
  tone?: "default" | "action";
}) => (
  <div className="flex items-baseline justify-between">
    <dt className="text-ink-700">{label}</dt>
    <dd
      className={cn(
        "tabular-nums",
        tone === "action" ? "text-action font-semibold" : "font-medium text-ink-900",
      )}
    >
      {value}
    </dd>
  </div>
);
