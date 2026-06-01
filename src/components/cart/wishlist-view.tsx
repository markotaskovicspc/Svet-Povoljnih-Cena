"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Heart, Loader2 } from "lucide-react";
import type { Product } from "@/types";
import { useWishlist } from "@/lib/hooks/use-wishlist";
import {
  ProductCard,
  ProductCardSkeleton,
} from "@/components/product/product-card";

/**
 * Full /nalog/lista-zelja page view. Mirrors the drawer layout but in a
 * responsive grid for browsing.
 */
export function WishlistView() {
  const hydrated = useWishlist((s) => s.hydrated);
  const items = useWishlist((s) => s.items);
  const remove = useWishlist((s) => s.remove);
  const enrichMissing = useWishlist((s) => s.enrichMissing);
  const [productsBySku, setProductsBySku] = useState<Record<string, Product>>({});
  const [productsLoading, setProductsLoading] = useState(true);
  const skuKey = useMemo(() => items.map((item) => item.sku).join("|"), [items]);

  useEffect(() => {
    if (hydrated) void enrichMissing();
  }, [enrichMissing, hydrated]);

  useEffect(() => {
    if (!hydrated || !items.length) return;
    let cancelled = false;

    async function loadProducts() {
      setProductsLoading(true);
      const response = await fetch("/api/products/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skus: items.map((item) => item.sku) }),
      }).catch(() => null);

      if (!response?.ok) {
        if (!cancelled) setProductsLoading(false);
        return;
      }

      const payload = (await response.json().catch(() => null)) as
        | { products?: Product[] }
        | null;
      if (!cancelled) {
        setProductsBySku(
          Object.fromEntries((payload?.products ?? []).map((product) => [product.sku, product])),
        );
        setProductsLoading(false);
      }
    }

    void loadProducts();
    return () => {
      cancelled = true;
    };
  }, [hydrated, items, skuKey]);

  if (!hydrated) {
    return (
      <div
        className="flex h-64 items-center justify-center text-ink-500"
        aria-live="polite"
      >
        <Loader2 className="size-5 animate-spin" aria-hidden />
        <span className="sr-only">Učitavanje liste želja…</span>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="bg-surface ring-border/60 mx-auto flex max-w-md flex-col items-center gap-3 rounded-2xl px-6 py-12 text-center ring-1">
        <span className="bg-muted-bg text-ink-500 inline-flex size-14 items-center justify-center rounded-full">
          <Heart className="size-6" aria-hidden />
        </span>
        <h2 className="font-display text-lg text-ink-900">Lista je prazna</h2>
        <p className="text-sm text-ink-500">
          Kliknite srce na bilo kojoj kartici proizvoda da ga sačuvate ovde.
        </p>
        <Link
          href="/akcija"
          className="bg-ink-900 hover:bg-walnut mt-2 inline-flex items-center rounded-full px-4 py-2 text-sm font-medium text-canvas transition"
        >
          Pogledaj akciju
        </Link>
      </div>
    );
  }

  const loadedProducts = items
    .map((entry) => productsBySku[entry.sku])
    .filter((product): product is Product => Boolean(product));
  const missingCount = Math.max(items.length - loadedProducts.length, 0);

  return (
    <div className="space-y-4">
      <ul className="grid grid-cols-2 gap-x-3 gap-y-4 sm:gap-x-4 sm:gap-y-6 lg:grid-cols-3 xl:grid-cols-4">
        {loadedProducts.map((product) => (
          <li key={product.sku}>
            <ProductCard product={product} className="h-full" />
          </li>
        ))}
        {productsLoading
          ? Array.from({ length: missingCount || Math.min(items.length, 4) }).map((_, index) => (
              <li key={`wishlist-loading-${index}`}>
                <ProductCardSkeleton className="h-full" />
              </li>
            ))
          : null}
      </ul>
      {!productsLoading && missingCount ? (
        <div className="rounded-lg bg-muted-bg px-4 py-3 text-sm text-ink-700">
          {missingCount}{" "}
          {missingCount === 1 ? "proizvod više nije dostupan." : "proizvoda više nije dostupno."}
          <button
            type="button"
            onClick={() => {
              items
                .filter((entry) => !productsBySku[entry.sku])
                .forEach((entry) => remove(entry.sku));
            }}
            className="ml-2 font-semibold text-action transition hover:text-walnut"
          >
            Ukloni nedostupne
          </button>
        </div>
      ) : null}
    </div>
  );
}
