"use client";

import { toast } from "sonner";
import type { Product } from "@/types";
import { useCart, type CartLine } from "@/lib/hooks/use-cart";
import { useCartUi } from "@/lib/hooks/use-cart-ui";
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
 *  - opens a persistent confirmation with a direct cart CTA
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

  const currentCartQty = useCart.getState().lines.find((item) => item.sku === product.sku)?.qty ?? 0;
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
  const addedLine = useCart.getState().lines.find((item) => item.sku === product.sku);
  if (addedLine) useCartUi.getState().showAddedItem(addedLine, Math.max(0, addedLine.qty - currentCartQty));
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

  return sale;
}

export function getCrossSell(product: Product, limit = 6): Product[] {
  void product;
  void limit;
  return [];
}
