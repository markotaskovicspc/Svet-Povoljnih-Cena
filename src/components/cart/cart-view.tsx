"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Loader2, ShoppingBag, Tag, Truck } from "lucide-react";
import { useCart } from "@/lib/hooks/use-cart";
import { formatRsd } from "@/lib/format";
import { cn } from "@/lib/utils";
import { CartLineRow } from "./cart-line-row";

/**
 * Full /korpa page view. Hydration-aware so server renders the empty state
 * (cart store is localStorage-only) without mismatch flicker.
 */
export function CartView() {
  const hydrated = useCart((s) => s.hydrated);
  const lines = useCart((s) => s.lines);

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
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
      <section
        aria-label="Stavke u korpi"
        className="bg-surface ring-border/60 divide-border/60 divide-y rounded-2xl px-4 ring-1 sm:px-6"
      >
        {lines.map((l) => (
          <CartLineRow key={l.sku} line={l} variant="page" />
        ))}
      </section>

      <CartSummary
        subtotal={subtotal}
        savings={savings}
        fullTotal={fullTotal}
      />
    </div>
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
}: {
  subtotal: number;
  savings: number;
  fullTotal: number;
}) {
  const [code, setCode] = useState("");
  const [applied, setApplied] = useState<{ code: string; valid: boolean } | null>(
    null,
  );

  function applyVoucher(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = code.trim();
    if (!trimmed) return;
    // Real validation lands in Phase 2 (POST /api/voucher/validate).
    setApplied({ code: trimmed, valid: false });
  }

  return (
    <aside
      aria-label="Sažetak narudžbine"
      className="lg:sticky lg:top-28 lg:self-start"
    >
      <div className="bg-surface ring-border/60 flex flex-col gap-4 rounded-2xl p-5 shadow-soft-2 ring-1">
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
              Isporuka
            </dt>
            <dd className="text-ink-500">obračun u sledećem koraku</dd>
          </div>
        </dl>

        <form
          onSubmit={applyVoucher}
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
              className="ring-border/60 focus-visible:ring-walnut/40 bg-canvas flex-1 rounded-full px-3 py-2 text-sm text-ink-900 ring-1 transition focus-visible:ring-2 focus-visible:outline-none"
            />
            <button
              type="submit"
              className="ring-border/60 hover:bg-muted-bg focus-visible:ring-walnut/40 inline-flex items-center rounded-full px-3 py-2 text-xs font-medium text-ink-900 ring-1 transition focus-visible:ring-2 focus-visible:outline-none"
            >
              Primeni
            </button>
          </div>
          {applied ? (
            <p
              className={cn(
                "text-[11px]",
                applied.valid ? "text-success" : "text-ink-500",
              )}
              aria-live="polite"
            >
              {applied.valid
                ? `Kod „${applied.code}" je primenjen.`
                : `Kod „${applied.code}" će biti proveren u sledećem koraku.`}
            </p>
          ) : null}
        </form>

        <div className="border-border/60 flex items-baseline justify-between border-t pt-3">
          <span className="text-sm font-medium text-ink-900">Ukupno za plaćanje</span>
          <span className="font-display text-2xl text-ink-900">
            {formatRsd(subtotal)}
          </span>
        </div>

        <Link
          href="/checkout"
          className="bg-ink-900 hover:bg-walnut focus-visible:ring-walnut/40 inline-flex items-center justify-center gap-2 rounded-full px-4 py-3 text-sm font-medium text-canvas transition focus-visible:ring-2 focus-visible:outline-none"
        >
          Nastavi ka podacima za isporuku
          <ArrowRight className="size-4" aria-hidden />
        </Link>
      </div>
    </aside>
  );
}
