"use client";

import Link from "next/link";
import { useEffect } from "react";
import { Heart, Loader2 } from "lucide-react";
import { useWishlist } from "@/lib/hooks/use-wishlist";
import { WishlistProductCard } from "@/components/cart/wishlist-product-card";

/**
 * Full /nalog/lista-zelja page view. Mirrors the drawer layout but in a
 * responsive grid for browsing.
 */
export function WishlistView() {
  const hydrated = useWishlist((s) => s.hydrated);
  const items = useWishlist((s) => s.items);
  const remove = useWishlist((s) => s.remove);
  const setNotify = useWishlist((s) => s.setNotify);
  const enrichMissing = useWishlist((s) => s.enrichMissing);

  useEffect(() => {
    if (hydrated) void enrichMissing();
  }, [enrichMissing, hydrated]);

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

  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {items.map((entry) => (
        <li key={entry.sku}>
          <WishlistProductCard
            entry={entry}
            onRemove={() => remove(entry.sku)}
            onNotifyChange={(key, value) => setNotify(entry.sku, key, value)}
          />
        </li>
      ))}
    </ul>
  );
}
