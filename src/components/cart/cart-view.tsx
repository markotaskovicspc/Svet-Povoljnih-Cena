"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ArrowRight, Loader2, LogIn, ShoppingBag, Tag, Truck } from "lucide-react";
import { useCart } from "@/lib/hooks/use-cart";
import type { CartLine } from "@/lib/hooks/use-cart";
import { formatRsd } from "@/lib/format";
import { CartLineRow } from "./cart-line-row";
import { useCheckout } from "@/lib/checkout/store";
import { useLoyaltyEligibility } from "@/components/pricing/pricing-eligibility";
import { useCartDeliveryQuote } from "@/lib/hooks/use-cart-delivery-quote";
import { useSession } from "next-auth/react";
import type { CheckoutDeliveryQuote } from "@/lib/checkout/config-shared";
import { DeliveryCategoryBreakdown } from "./delivery-category-breakdown";
import { customerLoginHref } from "@/lib/auth/customer-callback";
import { cartDrawerLoginReturnPath } from "@/lib/cart/cart-drawer-auth-return";

/**
 * Full /korpa page view. Hydration-aware so server renders the empty state
 * (cart store is localStorage-only) without mismatch flicker.
 */
export function CartView() {
  const hydrated = useCart((s) => s.hydrated);
  const lines = useCart((s) => s.lines);
  const { quote, loading: deliveryLoading } = useCartDeliveryQuote(
    lines,
    hydrated && lines.length > 0,
  );

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
  }, []);

  const subtotal = lines.reduce((n, l) => n + l.unitPriceSale * l.qty, 0);
  const savings = lines.reduce(
    (n, l) => n + (l.unitPriceFull - l.unitPriceSale) * l.qty,
    0,
  );
  const fullTotal = lines.reduce((n, l) => n + l.unitPriceFull * l.qty, 0);

  if (!hydrated) {
    return (
      <div
        className="flex h-64 items-center justify-center text-ink-500"
        aria-live="polite"
      >
        <Loader2 className="size-5 animate-spin" aria-hidden />
        <span className="sr-only">Učitavanje korpe…</span>
      </div>
    );
  }

  if (lines.length === 0) {
    return <CartEmptyState />;
  }

  return (
    <>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section
          aria-label="Stavke u korpi"
          className="bg-surface ring-border/60 divide-border/60 divide-y rounded-2xl px-4 ring-1 sm:px-6"
        >
          <CartLoginOffer />
          {lines.map((l) => (
            <CartLineRow
              key={l.sku}
              line={l}
              variant="page"
              deliveryCategory={
                quote ? quote.deliveryCategoriesBySku?.[l.sku] ?? null : undefined
              }
            />
          ))}
        </section>

        <CartSummary
          subtotal={subtotal}
          savings={savings}
          fullTotal={fullTotal}
          quote={quote}
          deliveryLoading={deliveryLoading}
        />
      </div>

      <div
        data-testid="mobile-cart-checkout-bar"
        className="border-border/60 fixed inset-x-0 bottom-0 z-50 border-t bg-white/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-8px_24px_rgba(36,30,25,0.10)] backdrop-blur md:hidden"
      >
        <Link
          href="/checkout/podaci"
          onClick={(event) => {
            event.preventDefault();
            window.location.assign("/checkout/podaci");
          }}
          className="bg-ink-900 hover:bg-walnut focus-visible:ring-walnut/40 mx-auto inline-flex w-full max-w-[var(--container-page)] items-center justify-center gap-2 rounded-full px-4 py-3 text-sm font-medium text-canvas transition focus-visible:ring-2 focus-visible:outline-none"
        >
          Nastavi ka podacima za isporuku
          <ArrowRight className="size-4" aria-hidden />
        </Link>
      </div>
    </>
  );
}

function CartEmptyState() {
  return (
    <div className="bg-surface ring-border/60 mx-auto flex max-w-md flex-col items-center gap-3 rounded-2xl px-6 py-12 text-center ring-1">
      <span className="bg-muted-bg text-ink-500 inline-flex size-14 items-center justify-center rounded-full">
        <ShoppingBag className="size-6" aria-hidden />
      </span>
      <h2 className="font-display text-lg text-ink-900">Korpa je prazna</h2>
      <p className="text-sm text-ink-500">
        Pogledajte aktuelne akcije ili nastavite kupovinu sa naslovne strane.
      </p>
      <div className="mt-2 flex flex-wrap justify-center gap-2">
        <Link
          href="/akcija"
          className="bg-ink-900 hover:bg-walnut focus-visible:ring-walnut/40 inline-flex items-center rounded-full px-4 py-2 text-sm font-medium text-canvas transition focus-visible:ring-2 focus-visible:outline-none"
        >
          Pogledaj akciju
        </Link>
        <Link
          href="/"
          className="ring-border/60 hover:bg-muted-bg focus-visible:ring-walnut/40 inline-flex items-center rounded-full px-4 py-2 text-sm font-medium text-ink-900 ring-1 transition focus-visible:ring-2 focus-visible:outline-none"
        >
          Naslovna
        </Link>
      </div>
    </div>
  );
}

function CartSummary({
  subtotal,
  savings,
  fullTotal,
  quote,
  deliveryLoading,
}: {
  subtotal: number;
  savings: number;
  fullTotal: number;
  quote: CheckoutDeliveryQuote | null;
  deliveryLoading: boolean;
}) {
  const voucher = useCheckout((s) => s.voucher);
  const applyVoucher = useCheckout((s) => s.applyVoucher);
  const [code, setCode] = useState("");
  const [voucherError, setVoucherError] = useState<string | null>(null);
  const [checkingVoucher, setCheckingVoucher] = useState(false);
  const shippingMethod = quote?.recommendedMethod ?? null;
  const shipping = shippingMethod ? quote?.prices[shippingMethod] ?? null : null;
  const voucherDiscount = Math.min(voucher?.discountRsd ?? 0, subtotal);
  const total =
    shipping == null
      ? null
      : Math.max(0, subtotal + shipping - voucherDiscount);

  async function applyCartVoucher(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = code.trim();
    if (!trimmed) {
      applyVoucher(null);
      setVoucherError("Unesite kod");
      return;
    }
    setCheckingVoucher(true);
    setVoucherError(null);
    const response = await fetch("/api/voucher/validate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: trimmed, subtotal }),
    });
    const result = (await response.json().catch(() => null)) as
      | { ok: true; code: string; label: string; discountRsd: number }
      | { ok: false; reason: string }
      | null;
    setCheckingVoucher(false);
    if (result?.ok) {
      applyVoucher({
        code: result.code,
        label: result.label,
        discountRsd: result.discountRsd,
      });
      setCode(result.code);
    } else {
      applyVoucher(null);
      setVoucherError(result?.reason ?? "Vaučer trenutno nije moguće proveriti");
    }
  }

  return (
    <aside
      aria-label="Sažetak narudžbine"
      className="lg:sticky lg:top-28 lg:self-start"
    >
      <div className="bg-surface ring-border/60 flex flex-col gap-3 rounded-2xl p-4 shadow-soft-2 ring-1 md:gap-4 md:p-5">
        <h2 className="font-display text-lg text-ink-900">Sažetak</h2>

        <dl className="flex flex-col gap-2 text-sm">
          <div className="flex items-baseline justify-between">
            <dt className="text-ink-700">Vrednost artikala</dt>
            <dd className="font-medium text-ink-900">{formatRsd(fullTotal)}</dd>
          </div>
          {savings > 0 ? (
            <div className="text-action flex items-baseline justify-between">
              <dt className="inline-flex items-center gap-1.5">
                <Tag className="size-3.5" aria-hidden />
                Ukupna ušteda
              </dt>
              <dd className="font-semibold">−{formatRsd(savings)}</dd>
            </div>
          ) : null}
          <div className="flex items-baseline justify-between">
            <dt className="text-ink-700 inline-flex items-center gap-1.5">
              <Truck className="size-3.5" aria-hidden />
              {shippingMethod === "kamion" ? "Kamionska isporuka" : "Isporuka"}
            </dt>
            <dd className="font-medium text-ink-900">
              {shipping == null
                ? deliveryLoading
                  ? "Računam…"
                  : "Nije dostupno"
                : formatRsd(shipping)}
            </dd>
          </div>
          <DeliveryCategoryBreakdown
            breakdown={quote?.deliveryCategoryBreakdown ?? null}
          />
          {shippingMethod === "kamion" ? (
            <p className="text-ink-500 text-xs">
              Za ovu korpu primenjena je fiksna tarifa za kamionsku isporuku.
            </p>
          ) : null}
          {shipping == null && !deliveryLoading ? (
            <p className="text-action text-xs">
              Za ovu korpu dostava ne može automatski da se obračuna.
            </p>
          ) : null}
        </dl>

        <form
          onSubmit={applyCartVoucher}
          className="border-border/60 flex flex-col gap-2 border-t pt-3"
          aria-label="Voucher kod"
        >
          <label htmlFor="voucher-code" className="text-xs text-ink-700">
            Voucher / promo kod
          </label>
          <div className="flex gap-2">
            <input
              id="voucher-code"
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="npr. SPRING-10"
              className="ring-border/60 focus-visible:ring-walnut/40 bg-canvas flex-1 rounded-full px-3 py-2 text-base text-ink-900 ring-1 transition focus-visible:ring-2 focus-visible:outline-none md:text-sm"
            />
            <button
              type="submit"
              disabled={checkingVoucher}
              className="ring-border/60 hover:bg-muted-bg focus-visible:ring-walnut/40 inline-flex items-center rounded-full px-3 py-2 text-xs font-medium text-ink-900 ring-1 transition focus-visible:ring-2 focus-visible:outline-none"
            >
              {checkingVoucher ? "Provera..." : "Primeni"}
            </button>
          </div>
          {voucher ? (
            <div className="flex items-center justify-between gap-2 text-[11px] text-success">
              <p aria-live="polite">
                Kod „{voucher.code}” je primenjen ({voucher.label}).
              </p>
              <button
                type="button"
                className="font-medium text-ink-500 hover:text-action"
                onClick={() => applyVoucher(null)}
              >
                Ukloni
              </button>
            </div>
          ) : voucherError ? (
            <p className="text-action text-[11px]" aria-live="polite">
              {voucherError}
            </p>
          ) : null}
        </form>

        {voucherDiscount > 0 ? (
          <div className="text-action flex items-baseline justify-between text-sm">
            <span>Vaučer „{voucher?.code}”</span>
            <span className="font-semibold">−{formatRsd(voucherDiscount)}</span>
          </div>
        ) : null}

        <div className="border-border/60 flex items-baseline justify-between border-t pt-3">
          <span className="text-sm font-medium text-ink-900">Ukupno za plaćanje</span>
          <span className="font-display text-2xl text-ink-900">
            {total == null ? "—" : formatRsd(total)}
          </span>
        </div>

        <Link
          href="/checkout/podaci"
          onClick={(event) => {
            event.preventDefault();
            window.location.assign("/checkout/podaci");
          }}
          className="bg-ink-900 hover:bg-walnut focus-visible:ring-walnut/40 hidden items-center justify-center gap-2 rounded-full px-4 py-3 text-sm font-medium text-canvas transition focus-visible:ring-2 focus-visible:outline-none md:inline-flex"
        >
          Nastavi ka podacima za isporuku
          <ArrowRight className="size-4" aria-hidden />
        </Link>
      </div>
    </aside>
  );
}

export function getCartLoginOfferDetails(lines: CartLine[]) {
  const eligible = lines.filter(
    (line) =>
      line.unitPriceLoyalty != null &&
      line.unitPriceLoyalty > 0 &&
      line.unitPriceLoyalty < line.unitPriceSale,
  );
  const discountPct = eligible.length
    ? Math.max(...eligible.map((line) => line.loyaltyDiscountPct ?? 0)) || 30
    : 30;
  const potentialSavings = eligible.reduce(
    (total, line) =>
      total + (line.unitPriceSale - (line.unitPriceLoyalty ?? line.unitPriceSale)) * line.qty,
    0,
  );

  return { discountPct, potentialSavings };
}

export function CartLoginOfferCopy({
  discountPct,
  potentialSavings,
}: {
  discountPct: number;
  potentialSavings: number;
}) {
  return (
    <div>
      <p className="text-action text-base font-extrabold uppercase sm:text-lg">
        PRIJAVITE SE I OSTVARITE {discountPct}% LOYALTY POPUSTA
      </p>
      <p className="mt-0.5 text-sm font-semibold text-ink-900">
        15% popusta za prvu kupovinu
      </p>
      <p className="mt-0.5 text-xs text-ink-600">
        Važi za artikle koji nisu na akciji.
        {potentialSavings > 0
          ? ` Moguća dodatna ušteda u ovoj korpi: ${formatRsd(potentialSavings)}.`
          : null}
      </p>
    </div>
  );
}

export function CartLoginOffer({
  onNavigate,
  reopenDrawerAfterLogin = false,
}: {
  onNavigate?: () => void;
  reopenDrawerAfterLogin?: boolean;
} = {}) {
  const loyaltyEligible = useLoyaltyEligibility();
  const { data: session, status } = useSession();
  const loggedIn =
    loyaltyEligible ||
    (status === "authenticated" && session?.user?.userType === "customer");
  const lines = useCart((state) => state.lines);
  if (status === "loading" || loggedIn || !lines.length) return null;

  const { discountPct, potentialSavings } = getCartLoginOfferDetails(lines);

  return (
    <div className="border-action/30 bg-action/5 flex flex-col gap-3 border-y px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
      <div className="flex items-start gap-3">
        <span className="bg-walnut text-canvas inline-flex size-9 shrink-0 items-center justify-center rounded-full">
          <LogIn className="size-4" aria-hidden />
        </span>
        <CartLoginOfferCopy
          discountPct={discountPct}
          potentialSavings={potentialSavings}
        />
      </div>
      {reopenDrawerAfterLogin ? (
        <CartDrawerLoginOfferLink onNavigate={onNavigate} />
      ) : (
        <CartLoginOfferLink onNavigate={onNavigate} />
      )}
    </div>
  );
}

export function CartLoginOfferLink({
  onNavigate,
}: {
  onNavigate?: () => void;
}) {
  return (
    <Link
      href={customerLoginHref("/korpa")}
      onClick={onNavigate}
      className="bg-ink-900 hover:bg-walnut inline-flex shrink-0 items-center justify-center rounded-full px-4 py-2 text-xs font-medium text-canvas transition"
    >
      Prijavite se
    </Link>
  );
}

function CartDrawerLoginOfferLink({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const fallbackReturnPath = cartDrawerLoginReturnPath(pathname);

  return (
    <Link
      href={customerLoginHref(fallbackReturnPath)}
      onClick={(event) => {
        if (
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        ) {
          return;
        }

        event.preventDefault();
        onNavigate?.();
        const returnPath = cartDrawerLoginReturnPath(
          window.location.pathname,
          window.location.search,
          window.location.hash,
        );
        router.push(customerLoginHref(returnPath));
      }}
      className="bg-ink-900 hover:bg-walnut inline-flex shrink-0 items-center justify-center rounded-full px-4 py-2 text-xs font-medium text-canvas transition"
    >
      Prijavite se
    </Link>
  );
}
