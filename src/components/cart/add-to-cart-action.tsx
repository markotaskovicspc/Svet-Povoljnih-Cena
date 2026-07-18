"use client";

import Image from "next/image";
import Link from "next/link";
import { X } from "lucide-react";
import { toast } from "sonner";
import type { Product } from "@/types";
import { useCart, type CartLine } from "@/lib/hooks/use-cart";
import { useCartUi } from "@/lib/hooks/use-cart-ui";
import { formatRsd } from "@/lib/format";
import { getMediaVariantUrl } from "@/lib/media";
import { effectiveUnitPrice } from "@/lib/pricing";
import { getProductAvailability } from "@/lib/product-availability";
import { recordFirstPartyEvent } from "@/components/analytics/first-party-analytics";

/**
 * Single entry-point used by every "Dodaj u korpu" trigger.
 *
 *  - persists the line in the cart store
 *  - fires a toast with thumbnail + "Pogledaj korpu" CTA (per spec 1F.1)
 *  - does not open cart/cross-sell overlays; those are user-triggered from
 *    "Pregled korpe" / "Plati"
 *
 * Returns the resolved sale unit price for callers that need it.
 */
export function commitAddToCart(product: Product, qty = 1): number {
  const price = effectiveUnitPrice(product);
  const sale = price.effective;
  const availability = getProductAvailability(product);

  if (!availability.canAddToCart) {
    toast.error(availability.message);
    return sale;
  }

  const line: Omit<CartLine, "qty"> = {
    sku: product.sku,
    slug: product.slug,
    name: product.name,
    unitPriceFull: price.full,
    unitPriceSale: sale,
    thumbnailUrl: getMediaVariantUrl(product.media.images[0], "thumb") || undefined,
  };
  useCart.getState().add(line, qty);
  recordFirstPartyEvent({
    type: "ADD_TO_CART",
    productId: product.id,
    quantity: qty,
    value: sale * qty,
  });

  toast.custom((id) => <AddToast id={id} line={line} qty={qty} />, {
    duration: 4500,
  });
  return sale;
}

export function getCrossSell(product: Product, limit = 6): Product[] {
  void product;
  void limit;
  return [];
}

function AddToast({
  id,
  line,
  qty,
}: {
  id: string | number;
  line: Omit<CartLine, "qty">;
  qty: number;
}) {
  return (
    <div className="bg-surface ring-border/60 relative flex w-[320px] items-center gap-3 rounded-2xl p-3 pr-9 shadow-soft-3 ring-1">
      <button
        type="button"
        onClick={() => toast.dismiss(id)}
        aria-label="Zatvori obaveštenje"
        className="absolute top-2 right-2 inline-flex size-6 items-center justify-center rounded-full text-ink-500 transition hover:bg-muted-bg hover:text-ink-900 focus-visible:ring-2 focus-visible:ring-walnut/40 focus-visible:outline-none"
      >
        <X className="size-3.5" aria-hidden />
      </button>
      <div className="relative size-14 shrink-0 overflow-hidden rounded-xl bg-white ring-1 ring-border/60">
        {line.thumbnailUrl ? (
          <Image
            src={line.thumbnailUrl}
            alt={line.name}
            fill
            sizes="56px"
            className="object-contain p-1"
          />
        ) : null}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-success">
          Dodato u korpu
          {qty > 1 ? ` × ${qty}` : null}
        </p>
        <p className="truncate text-sm font-medium text-ink-900">{line.name}</p>
        <p className="text-xs text-ink-500">{formatRsd(line.unitPriceSale)}</p>
      </div>
      <Link
        href="/korpa"
        onClick={(event) => {
          event.preventDefault();
          toast.dismiss(id);
          useCartUi.getState().openSuggestion("/korpa");
        }}
        className="bg-ink-900 hover:bg-walnut focus-visible:ring-walnut/40 inline-flex shrink-0 items-center rounded-full px-3 py-1.5 text-xs font-medium text-canvas transition focus-visible:ring-2 focus-visible:outline-none"
      >
        Pogledaj korpu
      </Link>
    </div>
  );
}
