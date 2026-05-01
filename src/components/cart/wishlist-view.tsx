"use client";

import Image from "next/image";
import Link from "next/link";
import { Bell, BellOff, Heart, Loader2, ShoppingBag, Trash2 } from "lucide-react";
import { useWishlist } from "@/lib/hooks/use-wishlist";
import { mockProducts } from "@/data/products";
import { formatRsd } from "@/lib/format";
import { commitAddToCart } from "./add-to-cart-action";
import { cn } from "@/lib/utils";

/**
 * Full /nalog/lista-zelja page view. Mirrors the drawer layout but in a
 * responsive grid for browsing.
 */
export function WishlistView() {
  const hydrated = useWishlist((s) => s.hydrated);
  const items = useWishlist((s) => s.items);
  const remove = useWishlist((s) => s.remove);
  const setNotify = useWishlist((s) => s.setNotify);

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
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((entry) => {
        const product = mockProducts.find((p) => p.sku === entry.sku);
        if (!product) return null;
        const sale = product.salePrice ?? product.fullPrice;
        const onSale = !!product.salePrice && product.salePrice < product.fullPrice;
        const outOfStock = product.stock === 0;
        return (
          <li
            key={entry.sku}
            className="bg-surface ring-border/60 flex flex-col overflow-hidden rounded-2xl shadow-soft-1 ring-1"
          >
            <Link
              href={`/p/${product.slug}`}
              className="relative block aspect-[4/5] overflow-hidden bg-muted-bg"
            >
              {product.media.images[0] ? (
                <Image
                  src={product.media.images[0].url}
                  alt={product.name}
                  fill
                  sizes="(min-width: 1024px) 25vw, (min-width: 640px) 50vw, 100vw"
                  className="object-cover transition duration-700 hover:scale-[1.03]"
                />
              ) : null}
            </Link>
            <div className="flex flex-1 flex-col gap-2 p-4">
              <Link
                href={`/p/${product.slug}`}
                className="hover:text-walnut line-clamp-2 text-sm font-medium text-ink-900 transition focus-visible:underline focus-visible:outline-none"
              >
                {product.name}
              </Link>
              <div className="flex items-baseline gap-2">
                <span
                  className={cn(
                    "text-base font-semibold",
                    onSale ? "text-action" : "text-ink-900",
                  )}
                >
                  {formatRsd(sale)}
                </span>
                {onSale ? (
                  <span className="text-xs text-ink-500 line-through">
                    {formatRsd(product.fullPrice)}
                  </span>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2 pt-1">
                <NotifyToggle
                  label="Obavesti me kad bude na akciji"
                  active={!!entry.notifyOnSale}
                  onClick={() =>
                    setNotify(entry.sku, "notifyOnSale", !entry.notifyOnSale)
                  }
                />
                <NotifyToggle
                  label="Obavesti me kad bude na stanju"
                  active={!!entry.notifyOnRestock}
                  onClick={() =>
                    setNotify(
                      entry.sku,
                      "notifyOnRestock",
                      !entry.notifyOnRestock,
                    )
                  }
                />
              </div>
              <div className="border-border/60 mt-auto flex items-center justify-between gap-2 border-t pt-3">
                <button
                  type="button"
                  onClick={() => remove(entry.sku)}
                  className="hover:text-action focus-visible:ring-walnut/40 inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs text-ink-500 transition focus-visible:ring-2 focus-visible:outline-none"
                >
                  <Trash2 className="size-3.5" aria-hidden />
                  Ukloni
                </button>
                <button
                  type="button"
                  disabled={outOfStock}
                  onClick={() => commitAddToCart(product)}
                  className="bg-ink-900 hover:bg-walnut focus-visible:ring-walnut/40 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium text-canvas transition focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50"
                >
                  <ShoppingBag className="size-3.5" aria-hidden />
                  Dodaj u korpu
                </button>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function NotifyToggle({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  const Icon = active ? Bell : BellOff;
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "ring-border/60 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] ring-1 transition",
        active
          ? "bg-walnut/10 text-walnut ring-walnut/30"
          : "text-ink-500 hover:bg-muted-bg",
      )}
    >
      <Icon className="size-3" aria-hidden />
      {label}
    </button>
  );
}
