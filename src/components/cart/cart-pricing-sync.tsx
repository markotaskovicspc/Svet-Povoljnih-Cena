"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useCart } from "@/lib/hooks/use-cart";
import { useLoyaltyEligibility } from "@/components/pricing/pricing-eligibility";
import { resolveProductPriceQuote } from "@/lib/pricing";
import { getMediaVariantUrl } from "@/lib/media";
import type { Product } from "@/types";
import { useCheckout } from "@/lib/checkout/store";

/** Keeps persisted cart snapshots aligned with current rules and auth state. */
export function CartPricingSync() {
  const pathname = usePathname();
  const loyaltyEligible = useLoyaltyEligibility();
  const checkoutStep = useCheckout((state) => state.step);
  const hydrated = useCart((state) => state.hydrated);
  const skuKey = useCart((state) =>
    state.lines.map((line) => line.sku).sort().join("|"),
  );
  const reprice = useCart((state) => state.reprice);

  useEffect(() => {
    if (!hydrated || !skuKey) return;
    const controller = new AbortController();
    const skus = skuKey.split("|");

    async function sync() {
      try {
        const batches: string[][] = [];
        for (let index = 0; index < skus.length; index += 50) {
          batches.push(skus.slice(index, index + 50));
        }
        const payloads = await Promise.all(
          batches.map(async (batch) => {
            const response = await fetch("/api/products/lookup", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ skus: batch }),
              signal: controller.signal,
            });
            if (!response.ok) throw new Error("cart pricing lookup failed");
            return (await response.json()) as { products?: Product[] };
          }),
        );
        const products = payloads.flatMap((payload) => payload.products ?? []);
        reprice(
          products.map((product) => {
            const quote = resolveProductPriceQuote(product, {
              loggedIn: loyaltyEligible,
            });
            return {
              sku: product.sku,
              name: product.name,
              slug: product.slug,
              unitPriceFull: quote.full,
              unitPriceSale: quote.payable.effective,
              unitPriceLoyalty: quote.loyaltyOffer?.effective,
              loyaltyDiscountPct: quote.loyaltyOffer?.discountPct,
              thumbnailUrl:
                getMediaVariantUrl(product.media.images[0], "thumb") || undefined,
            };
          }),
        );
      } catch (error) {
        if (!controller.signal.aborted) {
          console.warn("[cart] Failed to refresh current prices.", error);
        }
      }
    }

    void sync();
    return () => controller.abort();
  }, [checkoutStep, hydrated, loyaltyEligible, pathname, reprice, skuKey]);

  return null;
}
