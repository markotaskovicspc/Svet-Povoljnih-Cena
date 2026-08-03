"use client";

/**
 * Sticky add-to-cart for the PDP.
 * Desktop: renders as a sticky right-column card.
 * Mobile: renders as a fixed bottom bar so the primary action is never duplicated.
 *
 * Keeps the purchase control visible on desktop and mobile; stock messaging can
 * be layered into the same control when backend availability rules are final.
 */
import { useEffect, useState } from "react";
import { Heart } from "lucide-react";
import type { Product } from "@/types";
import { cn } from "@/lib/utils";
import { commitAddToCart } from "@/components/cart/add-to-cart-action";
import { CartQuantityControl } from "@/components/cart/cart-quantity-control";
import {
  getProductAvailability,
  type ProductAvailability,
} from "@/lib/product-availability";
import { useCart } from "@/lib/hooks/use-cart";
import { useIsWished, useWishlist } from "@/lib/hooks/use-wishlist";
import { useLoyaltyEligibility } from "@/components/pricing/pricing-eligibility";
import {
  resolveProductPriceQuote,
  type ProductPriceQuote,
} from "@/lib/pricing";
import { formatRsd } from "@/lib/format";

interface PdpAddToCartProps {
  product: Product;
  /** When true, render only the desktop card (used inside the right column). */
  variant: "desktop" | "mobile";
}

export function getPdpAvailabilityMessage(
  product: Pick<Product, "deliveryDays">,
  availability: ProductAvailability,
) {
  if (availability.isSupplierSourced) return availability.message;
  if (availability.canAddToCart) {
    return `Isporuka ${product.deliveryDays.min}–${product.deliveryDays.max} radnih dana`;
  }
  return availability.message ===
    "Trenutno nije dostupno za online kupovinu"
    ? null
    : availability.message;
}

export function PdpMobilePriceContent({
  quote,
}: {
  quote: ProductPriceQuote;
}) {
  const reducedOffer = quote.actionOffer ?? quote.loyaltyOffer;

  if (!reducedOffer) {
    return (
      <div className="min-w-[88px] shrink-0">
        <p className="text-[10px] font-medium uppercase tracking-wide text-ink-500">
          Cena
        </p>
        <p className="text-base leading-tight font-black whitespace-nowrap text-ink-900">
          {formatRsd(quote.full)}
        </p>
      </div>
    );
  }

  const isLoyalty = !quote.actionOffer && Boolean(quote.loyaltyOffer);

  return (
    <div className="min-w-[94px] shrink-0">
      <p className="whitespace-nowrap text-[9px] leading-tight font-medium text-ink-500">
        Redovna:{" "}
        <span className={cn(!isLoyalty && "line-through")}>
          {formatRsd(quote.full)}
        </span>
      </p>
      <p className="mt-0.5 text-[9px] leading-tight font-semibold uppercase tracking-wide text-action">
        {isLoyalty ? "Loyalty cena" : "Akcijska cena"}
      </p>
      <p className="text-[19px] leading-none font-black whitespace-nowrap text-action">
        {formatRsd(reducedOffer.effective)}
      </p>
    </div>
  );
}

export function PdpAddToCart({ product, variant }: PdpAddToCartProps) {
  const loyaltyEligible = useLoyaltyEligibility();
  const [isActiveVariant, setIsActiveVariant] = useState(false);
  const [liveAvailability, setLiveAvailability] =
    useState<ProductAvailability | null>(null);
  const pricingProduct =
    product.loyaltyEligible === loyaltyEligible
      ? product
      : { ...product, loyaltyEligible };
  const wished = useIsWished(product.sku);
  const toggleWish = useWishlist((s) => s.toggleProduct);
  const lineQty = useCart(
    (s) => s.lines.find((l) => l.sku === product.sku)?.qty ?? 0,
  );
  const availability = liveAvailability ?? getProductAvailability(product);
  const availabilityMessage = getPdpAvailabilityMessage(product, availability);
  const priceQuote = resolveProductPriceQuote(pricingProduct);

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 768px)");
    const update = () =>
      setIsActiveVariant(
        variant === "desktop" ? desktop.matches : !desktop.matches,
      );

    update();
    desktop.addEventListener("change", update);
    return () => desktop.removeEventListener("change", update);
  }, [variant]);

  useEffect(() => {
    if (!isActiveVariant) return;

    let cancelled = false;
    let activeController: AbortController | null = null;

    async function refreshAvailability() {
      activeController?.abort();
      const controller = new AbortController();
      activeController = controller;
      try {
        const response = await fetch(
          `/api/products/${encodeURIComponent(product.slug)}/availability`,
          { signal: controller.signal },
        );
        if (!response.ok) return;
        const payload = (await response.json()) as {
          availability?: ProductAvailability;
        };
        if (!cancelled && payload.availability) {
          setLiveAvailability(payload.availability);
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          console.warn("[availability] Failed to refresh PDP availability.", error);
        }
      }
    }

    void refreshAvailability();
    const interval = window.setInterval(refreshAvailability, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      activeController?.abort();
    };
  }, [isActiveVariant, product.slug]);

  function handleAdd() {
    if (!availability.canAddToCart) return;
    commitAddToCart(pricingProduct, 1, { availability });
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
        {availabilityMessage ? (
          <p className="text-xs text-ink-500" aria-live="polite">
            {availabilityMessage}
          </p>
        ) : null}
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
          onClick={() => toggleWish(pricingProduct)}
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
        <PdpMobilePriceContent quote={priceQuote} />
        {ctas}
      </div>
    </div>
  );
}
