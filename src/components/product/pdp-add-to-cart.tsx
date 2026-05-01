"use client";

/**
 * Sticky add-to-cart for the PDP.
 * Desktop: renders as a sticky right-column card.
 * Mobile: renders as a sticky bottom bar (fixed) once scrolled past the hero.
 *
 * Auto-hides if the product is fully out of stock (stock=0 && incomingStock=0);
 * the route itself returns notFound in that case, so this is just a guard.
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Minus, Plus, ShoppingBag } from "lucide-react";
import type { Product } from "@/types";
import { cn } from "@/lib/utils";
import { formatRsd } from "@/lib/format";
import { useCart } from "@/lib/hooks/use-cart";
import { commitAddToCart } from "@/components/cart/add-to-cart-action";

interface PdpAddToCartProps {
  product: Product;
  /** When true, render only the desktop card (used inside the right column). */
  variant: "desktop" | "mobile";
}

export function PdpAddToCart({ product, variant }: PdpAddToCartProps) {
  const reduced = useReducedMotion();
  const setQty = useCart((s) => s.setQty);
  const lineQty = useCart(
    (s) => s.lines.find((l) => l.sku === product.sku)?.qty ?? 0,
  );

  const [pickQty, setPickQty] = useState(1);
  const [showMobile, setShowMobile] = useState(false);

  useEffect(() => {
    if (variant !== "mobile") return;
    const onScroll = () => setShowMobile(window.scrollY > 320);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [variant]);

  const outOfStock = product.stock === 0 && product.incomingStock === 0;
  if (outOfStock) return null;

  const sale = product.salePrice ?? product.fullPrice;
  const onSale = !!product.salePrice && product.salePrice < product.fullPrice;

  function handleAdd() {
    commitAddToCart(product, pickQty);
  }

  const stepper = (
    <div
      role="group"
      aria-label="Količina"
      className="bg-canvas ring-border/60 inline-flex items-center overflow-hidden rounded-full ring-1"
    >
      <button
        type="button"
        onClick={() => setPickQty((q) => Math.max(1, q - 1))}
        aria-label="Smanji količinu"
        className="hover:bg-muted-bg focus-visible:ring-walnut/40 inline-flex size-9 items-center justify-center text-ink-700 transition focus-visible:ring-2 focus-visible:outline-none"
      >
        <Minus className="size-4" aria-hidden />
      </button>
      <span
        aria-live="polite"
        className="min-w-7 text-center text-sm font-medium tabular-nums text-ink-900"
      >
        {pickQty}
      </span>
      <button
        type="button"
        onClick={() => setPickQty((q) => q + 1)}
        aria-label="Povećaj količinu"
        className="hover:bg-muted-bg focus-visible:ring-walnut/40 inline-flex size-9 items-center justify-center text-ink-700 transition focus-visible:ring-2 focus-visible:outline-none"
      >
        <Plus className="size-4" aria-hidden />
      </button>
    </div>
  );

  const ctas = (
    <div className="flex flex-1 items-center gap-2">
      {stepper}
      <button
        type="button"
        onClick={handleAdd}
        className="bg-ink-900 hover:bg-walnut focus-visible:ring-walnut/40 inline-flex flex-1 items-center justify-center gap-2 rounded-full px-4 py-2.5 text-sm font-medium text-canvas transition focus-visible:ring-2 focus-visible:outline-none"
      >
        <ShoppingBag className="size-4" aria-hidden />
        Dodaj u korpu
      </button>
    </div>
  );

  if (variant === "desktop") {
    return (
      <div className="bg-surface ring-border/60 sticky top-28 hidden flex-col gap-4 rounded-2xl p-5 shadow-soft-2 ring-1 md:flex">
        <div className="flex items-baseline gap-2">
          {onSale ? (
            <>
              <span className="text-action text-2xl font-semibold">
                {formatRsd(sale)}
              </span>
              <span className="text-sm text-ink-500 line-through">
                {formatRsd(product.fullPrice)}
              </span>
            </>
          ) : (
            <span className="text-2xl font-semibold text-ink-900">
              {formatRsd(product.fullPrice)}
            </span>
          )}
        </div>
        <p className="text-xs text-ink-500">
          Isporuka {product.deliveryDays.min}–{product.deliveryDays.max} radnih dana
        </p>
        {ctas}
        <div className="flex items-center justify-between text-xs">
          {lineQty > 0 ? (
            <span className="text-success" aria-live="polite">
              U korpi: {lineQty} kom
            </span>
          ) : (
            <span className="text-ink-500">Nije u korpi</span>
          )}
          <Link
            href="/korpa"
            className="text-walnut hover:underline focus-visible:underline focus-visible:outline-none"
          >
            Pregled korpe
          </Link>
        </div>
        {lineQty > 0 ? (
          <div className="border-border/60 flex items-center justify-between border-t pt-3">
            <span className="text-xs text-ink-500">Promeni količinu u korpi</span>
            <div className="bg-canvas ring-border/60 inline-flex items-center overflow-hidden rounded-full ring-1">
              <button
                type="button"
                onClick={() => setQty(product.sku, lineQty - 1)}
                aria-label="Smanji u korpi"
                className="hover:bg-muted-bg inline-flex size-7 items-center justify-center text-ink-700"
              >
                <Minus className="size-3.5" aria-hidden />
              </button>
              <span className="min-w-6 text-center text-xs font-medium tabular-nums">
                {lineQty}
              </span>
              <button
                type="button"
                onClick={() => setQty(product.sku, lineQty + 1)}
                aria-label="Povećaj u korpi"
                className="hover:bg-muted-bg inline-flex size-7 items-center justify-center text-ink-700"
              >
                <Plus className="size-3.5" aria-hidden />
              </button>
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  // Mobile sticky bar
  return (
    <motion.div
      initial={false}
      animate={
        reduced
          ? { opacity: showMobile ? 1 : 0 }
          : { y: showMobile ? 0 : 80, opacity: showMobile ? 1 : 0 }
      }
      transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        "bg-surface/95 ring-border/60 fixed inset-x-3 bottom-3 z-40 rounded-2xl px-3 py-2.5 shadow-soft-3 ring-1 backdrop-blur md:hidden",
        !showMobile && "pointer-events-none",
      )}
      aria-hidden={!showMobile}
    >
      <div className="flex items-center gap-3">
        <div className="flex flex-col">
          <span
            className={cn(
              "text-sm font-semibold",
              onSale ? "text-action" : "text-ink-900",
            )}
          >
            {formatRsd(sale)}
          </span>
          {onSale ? (
            <span className="text-[11px] text-ink-500 line-through">
              {formatRsd(product.fullPrice)}
            </span>
          ) : null}
        </div>
        {ctas}
      </div>
    </motion.div>
  );
}
