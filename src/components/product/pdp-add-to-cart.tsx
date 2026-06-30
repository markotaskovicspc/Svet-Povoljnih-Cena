"use client";

/**
 * Sticky add-to-cart for the PDP.
 * Desktop: renders as a sticky right-column card.
 * Mobile: renders as a fixed bottom bar so the primary action is never duplicated.
 *
 * Keeps the purchase control visible on desktop and mobile; stock messaging can
 * be layered into the same control when backend availability rules are final.
 */
import { Heart } from "lucide-react";
import type { Product } from "@/types";
import { cn } from "@/lib/utils";
import { commitAddToCart } from "@/components/cart/add-to-cart-action";
import { CartQuantityControl } from "@/components/cart/cart-quantity-control";
import { getProductAvailability } from "@/lib/product-availability";
import { useCart } from "@/lib/hooks/use-cart";
import { useIsWished, useWishlist } from "@/lib/hooks/use-wishlist";

interface PdpAddToCartProps {
  product: Product;
  /** When true, render only the desktop card (used inside the right column). */
  variant: "desktop" | "mobile";
}

export function PdpAddToCart({ product, variant }: PdpAddToCartProps) {
  const wished = useIsWished(product.sku);
  const toggleWish = useWishlist((s) => s.toggleProduct);
  const lineQty = useCart(
    (s) => s.lines.find((l) => l.sku === product.sku)?.qty ?? 0,
  );
  const availability = getProductAvailability(product);

  function handleAdd() {
    if (!availability.canAddToCart) return;
    commitAddToCart(product, 1);
  }

  const ctas = (
    <div className="flex flex-1 items-center gap-2">
      {availability.canAddToCart ? (
        <CartQuantityControl
          sku={product.sku}
          quantity={lineQty}
          onAdd={handleAdd}
          size="md"
          tone="light"
          addTone="dark"
          fullWidth
          className="flex-1"
        />
      ) : (
        <CartQuantityControl
          sku={product.sku}
          quantity={0}
          onAdd={handleAdd}
          size="md"
          tone="light"
          addTone="light"
          fullWidth
          addDisabled
          addLabel={availability.addLabel}
          className="flex-1"
        />
      )}
    </div>
  );

  if (variant === "desktop") {
    return (
      <div className="hidden flex-col gap-2 md:flex">
        {ctas}
        <p className="text-xs text-ink-500">
          {availability.canAddToCart
            ? `Isporuka ${product.deliveryDays.min}–${product.deliveryDays.max} radnih dana`
            : availability.message}
        </p>
      </div>
    );
  }
  // Mobile sticky bar
  return (
    <div
      className="bg-surface/95 ring-border/60 fixed inset-x-0 bottom-0 z-40 rounded-t-xl px-4 pt-2.5 pb-[calc(env(safe-area-inset-bottom)+0.625rem)] shadow-soft-3 ring-1 backdrop-blur md:hidden"
    >
      <div className="mx-auto flex max-w-[520px] items-center gap-2.5">
        <button
          type="button"
          aria-pressed={wished}
          aria-label={wished ? "Ukloni iz liste želja" : "Dodaj u listu želja"}
          onClick={() => toggleWish(product)}
          className={cn(
            "ring-border/60 focus-visible:ring-walnut/40 inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-white text-ink-700 ring-1 transition hover:text-action focus-visible:ring-2 focus-visible:outline-none",
            wished && "text-action",
          )}
        >
          <Heart
            className={cn("size-5 transition", wished && "fill-action")}
            aria-hidden
          />
        </button>
        {ctas}
      </div>
    </div>
  );
}
