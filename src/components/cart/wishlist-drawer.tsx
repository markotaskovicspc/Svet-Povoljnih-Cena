"use client";

import Link from "next/link";
import { useEffect } from "react";
import { Heart } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useWishlist } from "@/lib/hooks/use-wishlist";
import { useCartUi } from "@/lib/hooks/use-cart-ui";
import { WishlistProductCard } from "@/components/cart/wishlist-product-card";

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
  const enrichMissing = useWishlist((s) => s.enrichMissing);

  useEffect(() => {
    if (open) void enrichMissing();
  }, [enrichMissing, open]);

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
          <div className="flex-1 overflow-y-auto px-4 py-3">
            {items.map((entry) => {
              return (
                <div key={entry.sku} className="mb-3 last:mb-0">
                  <WishlistProductCard
                    entry={entry}
                    compact
                    onNavigate={close}
                    onRemove={() => remove(entry.sku)}
                    onNotifyChange={(key, value) => setNotify(entry.sku, key, value)}
                  />
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
