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
import {
  getProductAvailability,
  type ProductAvailability,
} from "@/lib/product-availability";
import {
  recordFirstPartyEvent,
  recordCommerceAddToCart,
} from "@/components/analytics/first-party-analytics";
import { deliveryCategory } from "@/lib/delivery-tariff";

/**
 * Single entry-point used by every "Dodaj u korpu" trigger.
 *
 *  - persists the line in the cart store
 *  - fires a toast with thumbnail + "Pogledaj korpu" CTA (per spec 1F.1)
 *  - asks the global cross-sell modal for recommendations tied to this SKU
 *
 * Returns the resolved sale unit price for callers that need it.
 */
const pendingAvailabilityChecks = new Set<string>();

export async function commitAddToCart(
  product: Product,
  qty = 1,
  options?: {
    availability?: ProductAvailability;
    deliveryCategory?: 1 | 2 | null;
  },
): Promise<number> {
  const price = effectiveUnitPrice(product);
  const sale = price.effective;
  const availability = options?.availability ?? getProductAvailability(product);

  if (!availability.canAddToCart) {
    toast.error(availability.message);
    return sale;
  }

  if (pendingAvailabilityChecks.has(product.sku)) return sale;
  pendingAvailabilityChecks.add(product.sku);
  try {
    const currentQty =
      useCart.getState().lines.find((line) => line.sku === product.sku)?.qty ?? 0;
    const response = await fetch(
      `/api/products/${encodeURIComponent(product.slug)}/availability`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quantity: currentQty + qty }),
      },
    );
    const result = (await response.json().catch(() => null)) as
      | { available?: boolean; message?: string | null }
      | null;
    if (!response.ok || !result?.available) {
      toast.error(
        result?.message ??
          "Trenutno ne možemo da proverimo dostupnost artikla. Pokušajte ponovo.",
      );
      return sale;
    }
  } catch {
    toast.error(
      "Trenutno ne možemo da proverimo dostupnost artikla. Pokušajte ponovo.",
    );
    return sale;
  } finally {
    pendingAvailabilityChecks.delete(product.sku);
  }

  const line: Omit<CartLine, "qty"> = {
    sku: product.sku,
    slug: product.slug,
    name: product.name,
    unitPriceFull: price.full,
    unitPriceSale: sale,
    thumbnailUrl: getMediaVariantUrl(product.media.images[0], "thumb") || undefined,
    variant: product.variantFamily?.options.find((option) => option.sku === product.sku)?.label,
    familyCode: product.variantFamily?.code,
    deliveryCategory:
      options?.deliveryCategory ??
      (product.unitPackageDimensionsCm
        ? deliveryCategory([
            product.unitPackageDimensionsCm.w,
            product.unitPackageDimensionsCm.d,
            product.unitPackageDimensionsCm.h,
          ]) ?? undefined
        : undefined),
  };
  useCart.getState().add(line, qty);
  useCartUi.getState().openCrossSell(product.sku);
  recordFirstPartyEvent({
    type: "ADD_TO_CART",
    productId: product.id,
    quantity: qty,
    value: sale * qty,
  });
  recordCommerceAddToCart({
    sku: product.sku,
    name: product.name,
    unitPrice: sale,
    fullUnitPrice: price.full,
    quantity: qty,
    categories: product.categoryPath,
    variant: product.variantFamily?.options.find((option) => option.sku === product.sku)?.label,
    familyCode: product.variantFamily?.code,
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
