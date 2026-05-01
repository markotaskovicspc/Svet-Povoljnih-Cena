"use client";

import Image from "next/image";
import Link from "next/link";
import { Bell, BellOff, Heart, ShoppingBag, Trash2 } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useWishlist } from "@/lib/hooks/use-wishlist";
import { useCartUi } from "@/lib/hooks/use-cart-ui";
import { mockProducts } from "@/data/products";
import { formatRsd } from "@/lib/format";
import { commitAddToCart } from "./add-to-cart-action";
import { cn } from "@/lib/utils";

/**
 * Wishlist drawer (1F.4). Same row layout as the dedicated /nalog/lista-zelja
 * page, but rendered inside a side Sheet for quick access from the header.
 */
export function WishlistDrawer() {
  const open = useCartUi((s) => s.wishlistOpen);
  const setOpen = useCartUi((s) => s.setWishlist);
  const close = useCartUi((s) => s.closeWishlist);

  const items = useWishlist((s) => s.items);
  const remove = useWishlist((s) => s.remove);
  const setNotify = useWishlist((s) => s.setNotify);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent
        side="right"
        className="bg-canvas data-[side=right]:sm:max-w-md flex w-full flex-col"
      >
        <SheetHeader className="border-border/60 border-b">
          <SheetTitle className="font-display text-xl text-ink-900">
            Lista želja
            {items.length ? (
              <span className="ml-2 text-sm font-normal text-ink-500">
                ({items.length})
              </span>
            ) : null}
          </SheetTitle>
          <SheetDescription className="text-ink-500">
            Sačuvajte omiljene komade i primajte obaveštenja kad budu na akciji
            ili na stanju.
          </SheetDescription>
        </SheetHeader>

        {items.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
            <span className="bg-muted-bg text-ink-500 inline-flex size-14 items-center justify-center rounded-full">
              <Heart className="size-6" aria-hidden />
            </span>
            <p className="text-sm text-ink-700">
              Lista želja je prazna. Kliknite srce na kartici proizvoda.
            </p>
            <Link
              href="/akcija"
              onClick={close}
              className="bg-ink-900 hover:bg-walnut focus-visible:ring-walnut/40 mt-2 inline-flex items-center rounded-full px-4 py-2 text-sm font-medium text-canvas transition focus-visible:ring-2 focus-visible:outline-none"
            >
              Pogledaj akciju
            </Link>
          </div>
        ) : (
          <div className="divide-border/60 flex-1 divide-y overflow-y-auto px-4">
            {items.map((entry) => {
              const product = mockProducts.find((p) => p.sku === entry.sku);
              if (!product) return null;
              const sale = product.salePrice ?? product.fullPrice;
              const onSale = !!product.salePrice && product.salePrice < product.fullPrice;
              const outOfStock = product.stock === 0;
              return (
                <div key={entry.sku} className="flex gap-3 py-3">
                  <Link
                    href={`/p/${product.slug}`}
                    onClick={close}
                    className="relative size-16 shrink-0 overflow-hidden rounded-xl bg-muted-bg"
                  >
                    {product.media.images[0] ? (
                      <Image
                        src={product.media.images[0].url}
                        alt={product.name}
                        fill
                        sizes="64px"
                        className="object-cover"
                      />
                    ) : null}
                  </Link>
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <Link
                      href={`/p/${product.slug}`}
                      onClick={close}
                      className="hover:text-walnut line-clamp-2 text-sm font-medium text-ink-900 transition focus-visible:underline focus-visible:outline-none"
                    >
                      {product.name}
                    </Link>
                    <div className="flex items-baseline gap-1.5">
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
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      <NotifyToggle
                        label="Akcija"
                        active={!!entry.notifyOnSale}
                        onClick={() =>
                          setNotify(entry.sku, "notifyOnSale", !entry.notifyOnSale)
                        }
                      />
                      <NotifyToggle
                        label="Stanje"
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
                  </div>
                  <div className="flex shrink-0 flex-col items-end justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => remove(entry.sku)}
                      aria-label="Ukloni iz liste želja"
                      className="hover:text-action focus-visible:ring-walnut/40 inline-flex size-7 items-center justify-center rounded-full text-ink-500 transition focus-visible:ring-2 focus-visible:outline-none"
                    >
                      <Trash2 className="size-3.5" aria-hidden />
                    </button>
                    <button
                      type="button"
                      disabled={outOfStock}
                      onClick={() => {
                        commitAddToCart(product);
                        close();
                      }}
                      className="bg-ink-900 hover:bg-walnut focus-visible:ring-walnut/40 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium text-canvas transition focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50"
                    >
                      <ShoppingBag className="size-3" aria-hidden /> Dodaj
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {items.length > 0 ? (
          <div className="border-border/60 bg-surface mt-auto border-t p-4">
            <Link
              href="/nalog/lista-zelja"
              onClick={close}
              className="ring-border/60 hover:bg-muted-bg focus-visible:ring-walnut/40 inline-flex w-full items-center justify-center rounded-full px-4 py-2.5 text-sm font-medium text-ink-900 ring-1 transition focus-visible:ring-2 focus-visible:outline-none"
            >
              Otvori celu listu želja
            </Link>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
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
        "ring-border/60 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] ring-1 transition",
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
