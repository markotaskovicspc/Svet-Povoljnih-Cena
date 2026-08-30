"use client";

import Image from "next/image";
import { Loader2, ShieldCheck, Truck, Wrench } from "lucide-react";
import { useCart } from "@/lib/hooks/use-cart";
import { CartQuantityControl } from "@/components/cart/cart-quantity-control";
import { useCheckout } from "@/lib/checkout/store";
import {
  SHIPPING_PRICES,
  type CheckoutDeliveryQuote,
  type CheckoutPaymentMethodConfig,
} from "@/lib/checkout/config-shared";
import { formatRsd } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { PaymentMethod, ShippingMethod, SKU } from "@/types";
import { DeliveryCategoryBreakdown } from "@/components/cart/delivery-category-breakdown";
import { capDiscountComponents } from "@/lib/pricing/engine";
import {
  FIRST_PURCHASE_PCT,
  MAX_STACK_PCT,
} from "@/lib/pricing/config";

export interface SummaryTotals {
  itemsFull: number;
  itemsSale: number;
  savings: number;
  shipping: number | null;
  assembly: number;
  voucherDiscount: number;
  firstPurchaseDiscount: number;
  total: number | null;
}

export type DeliveryQuoteDisplayStatus = "loading" | "ready" | "error";

const UNRESOLVED_SHIPPING_PRICES: Record<ShippingMethod, number | null> = {
  kurir: null,
  kamion: null,
};

export function computeTotals({
  itemsFull,
  itemsSale,
  shippingMethod,
  assemblyTotal,
  voucherDiscountRsd,
  firstPurchaseEligible = false,
  shippingPrices = SHIPPING_PRICES,
}: {
  itemsFull: number;
  itemsSale: number;
  shippingMethod: ShippingMethod;
  assemblyTotal: number;
  voucherDiscountRsd: number;
  firstPurchaseEligible?: boolean;
  shippingPrices?: Record<ShippingMethod, number | null>;
}): SummaryTotals {
  const shipping = shippingPrices[shippingMethod];
  const eligibleSubtotal = Math.max(0, itemsSale);
  const requestedDiscounts = {
    voucher: Math.max(0, voucherDiscountRsd),
    first: firstPurchaseEligible
      ? Math.round((eligibleSubtotal * FIRST_PURCHASE_PCT) / 100)
      : 0,
    card: 0,
  };
  const appliedDiscounts = capDiscountComponents(
    requestedDiscounts,
    Math.round((eligibleSubtotal * MAX_STACK_PCT) / 100),
  );
  const voucherDiscount = appliedDiscounts.voucher;
  const firstPurchaseDiscount = appliedDiscounts.first;
  const total =
    shipping == null
      ? null
      : itemsSale +
        shipping +
        assemblyTotal -
        voucherDiscount -
        firstPurchaseDiscount;
  return {
    itemsFull,
    itemsSale,
    savings: itemsFull - itemsSale,
    shipping,
    assembly: assemblyTotal,
    voucherDiscount,
    firstPurchaseDiscount,
    total: total == null ? null : Math.max(0, total),
  };
}

interface OrderSummaryProps {
  deliveryQuote: CheckoutDeliveryQuote;
  deliveryQuoteStatus?: DeliveryQuoteDisplayStatus;
  paymentMethods?: CheckoutPaymentMethodConfig[];
  shippingMethod: ShippingMethod;
  paymentMethod?: PaymentMethod | null;
  perItemAssembly?: Record<SKU, boolean>;
  /** Server-resolved eligibility; the order API recalculates it authoritatively. */
  firstPurchaseEligible?: boolean;
  /** Optional CTA appended at the bottom (used by the final review state). */
  cta?: React.ReactNode;
  /** Content that must sit immediately above the desktop confirmation CTA. */
  beforeCta?: React.ReactNode;
  /** Hide the cart-line list; useful on confirmation page. */
  collapseLines?: boolean;
  className?: string;
  /** Tighter presentation used inside the mobile review step. */
  compact?: boolean;
  /** Show final-review quantities without checkout quantity controls. */
  readOnlyLines?: boolean;
}

export function OrderSummary({
  deliveryQuote,
  deliveryQuoteStatus = "ready",
  shippingMethod,
  perItemAssembly,
  firstPurchaseEligible = false,
  cta,
  beforeCta,
  collapseLines,
  className,
  compact = false,
  readOnlyLines = false,
}: OrderSummaryProps) {
  const hydrated = useCart((s) => s.hydrated);
  const lines = useCart((s) => s.lines);
  const voucher = useCheckout((s) => s.voucher);
  const deliveryQuoteReady = deliveryQuoteStatus === "ready";

  const itemsFull = lines.reduce((n, l) => n + l.unitPriceFull * l.qty, 0);
  const itemsSale = lines.reduce((n, l) => n + l.unitPriceSale * l.qty, 0);
  const assemblyTotal =
    shippingMethod === "kamion" && perItemAssembly
      ? lines.reduce(
          (n, l) =>
            n +
            (perItemAssembly[l.sku]
              ? (deliveryQuote.assemblyPricesBySku[l.sku] ??
                  deliveryQuote.assemblyPrice) * l.qty
              : 0),
          0,
        )
      : 0;

  const totals = computeTotals({
    itemsFull,
    itemsSale,
    shippingMethod,
    assemblyTotal,
    voucherDiscountRsd: voucher?.discountRsd ?? 0,
    firstPurchaseEligible,
    shippingPrices: deliveryQuoteReady
      ? deliveryQuote.prices
      : UNRESOLVED_SHIPPING_PRICES,
  });

  return (
    <aside
      aria-label="Sažetak porudžbine"
      className={cn("lg:sticky lg:top-28 lg:self-start", className)}
    >
      <div
        className={cn(
          "bg-surface ring-border/60 flex flex-col rounded-2xl shadow-soft-2 ring-1",
          compact ? "gap-3 p-3 sm:p-4" : "gap-4 p-5",
        )}
      >
        <h2 className="order-1 font-display text-lg text-ink-900">Sažetak porudžbine</h2>

        {!hydrated ? (
          <div className="order-2 flex h-24 items-center justify-center text-ink-500 lg:order-7">
            <Loader2 className="size-4 animate-spin" aria-hidden />
          </div>
        ) : !collapseLines ? (
          <ul className="order-2 divide-y divide-border/60 border-t border-border/60 pt-1 lg:order-7 lg:pt-2">
            {lines.map((l) => (
              <li
                key={l.sku}
                className={cn(
                  "grid items-center",
                  compact
                    ? "grid-cols-[36px_minmax(0,1fr)_auto] gap-2 py-2"
                    : "grid-cols-[44px_minmax(0,1fr)_auto] gap-3 py-3",
                )}
              >
                <span
                  className={cn(
                    "bg-white ring-border/60 relative block overflow-hidden rounded-lg ring-1",
                    compact ? "size-9" : "size-11",
                  )}
                >
                  {l.thumbnailUrl ? (
                    <Image
                      src={l.thumbnailUrl}
                      alt=""
                      fill
                      sizes="44px"
                      className="object-contain p-1"
                    />
                  ) : null}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-xs text-ink-900">{l.name}</p>
                  <p className="text-[11px] text-ink-500 tabular-nums">
                    {l.qty} × {formatRsd(l.unitPriceSale)}
                  </p>
                  {deliveryQuote.deliveryCategoriesBySku?.[l.sku] ? (
                    <p className="text-[11px] text-ink-500">
                      {deliveryQuote.deliveryCategoriesBySku?.[l.sku] === 1 ? "I" : "II"}{" "}
                      kategorija isporuke
                    </p>
                  ) : null}
                </div>
                <span className="text-xs font-medium text-ink-900 tabular-nums">
                  {formatRsd(l.unitPriceSale * l.qty)}
                </span>
                {!readOnlyLines ? (
                  <div className="col-start-2 col-span-2 -mt-1">
                    <CartQuantityControl sku={l.sku} quantity={l.qty} />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}

        <dl className="order-3 border-border/60 flex flex-col gap-1.5 border-t pt-3 text-sm lg:order-2">
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
            value={
              deliveryQuoteStatus === "loading"
                ? "Obračunavam…"
                : totals.shipping == null
                  ? "Nije moguće obračunati"
                  : formatRsd(totals.shipping)
            }
          />
          <DeliveryCategoryBreakdown
            breakdown={
              deliveryQuoteReady
                ? (deliveryQuote.deliveryCategoryBreakdown ?? null)
                : null
            }
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
          {totals.firstPurchaseDiscount > 0 ? (
            <Row
              label={`Popust za prvu kupovinu (${FIRST_PURCHASE_PCT}%)`}
              value={`−${formatRsd(totals.firstPurchaseDiscount)}`}
              tone="action"
            />
          ) : null}
        </dl>

        <div className="order-4 border-border/60 flex items-baseline justify-between border-t pt-3 lg:order-3">
          <span className="text-sm font-medium text-ink-900">
            Ukupno za plaćanje
          </span>
          <span className="font-display text-2xl text-ink-900">
            {totals.total == null ? "—" : formatRsd(totals.total)}
          </span>
        </div>

        {beforeCta ? <div className="order-5">{beforeCta}</div> : null}
        {cta ? <div className="order-6">{cta}</div> : null}

        <p className="order-8 border-border/60 inline-flex items-center gap-1.5 border-t pt-3 text-[11px] text-ink-500">
          <ShieldCheck className="size-3.5" aria-hidden />
          Sigurna naplata · 256-bit TLS · IPS / 3-D Secure
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
