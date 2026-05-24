"use client";

/**
 * Sticky add-to-cart for the PDP.
 * Desktop: renders as a sticky right-column card.
 * Mobile: renders as a fixed bottom bar so the primary action is never duplicated.
 *
 * Keeps the purchase control visible on desktop and mobile; stock messaging can
 * be layered into the same control when backend availability rules are final.
 */
import { useState } from "react";
import { Minus, Plus, ShoppingBag } from "lucide-react";
import type { Product } from "@/types";
import { cn } from "@/lib/utils";
import { formatRsd } from "@/lib/format";
import { commitAddToCart } from "@/components/cart/add-to-cart-action";
import { effectiveUnitPrice } from "@/lib/pricing";

interface PdpAddToCartProps {
  product: Product;
  /** When true, render only the desktop card (used inside the right column). */
  variant: "desktop" | "mobile";
}

export function PdpAddToCart({ product, variant }: PdpAddToCartProps) {
  const [pickQty, setPickQty] = useState(1);

  const price = effectiveUnitPrice(product);
  const sale = price.effective;
  const onSale = price.effective < price.full;

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
        <span className="whitespace-nowrap">Dodaj u korpu</span>
      </button>
    </div>
  );

  if (variant === "desktop") {
    return (
      <div className="hidden flex-col gap-2 md:flex">
        {ctas}
        <p className="text-xs text-ink-500">
          Isporuka {product.deliveryDays.min}–{product.deliveryDays.max} radnih dana
        </p>
      </div>
    );
  }
  // Mobile sticky bar
  return (
    <div
      className="bg-surface/95 ring-border/60 fixed inset-x-3 bottom-[max(env(safe-area-inset-bottom),0.75rem)] z-40 rounded-lg px-3 py-2.5 shadow-soft-3 ring-1 backdrop-blur md:hidden"
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
    </div>
  );
}
