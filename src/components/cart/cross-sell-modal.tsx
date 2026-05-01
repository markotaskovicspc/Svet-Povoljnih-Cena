"use client";

import Image from "next/image";
import Link from "next/link";
import { ShoppingBag } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useCartUi } from "@/lib/hooks/use-cart-ui";
import { mockProducts } from "@/data/products";
import { formatRsd } from "@/lib/format";
import { commitAddToCart, getCrossSell } from "./add-to-cart-action";
import { cn } from "@/lib/utils";

/**
 * "Predlog kupovine" modal (1F.1). Mounted globally; opens whenever
 * `useCartUi.crossSellSku` becomes non-null. Mock cross-sell pulls from
 * same group / collection until the admin per-group config exists (Phase 4).
 */
export function CrossSellModal() {
  const sku = useCartUi((s) => s.crossSellSku);
  const close = useCartUi((s) => s.closeCrossSell);

  const product = sku ? mockProducts.find((p) => p.sku === sku) : null;
  const items = product ? getCrossSell(product) : [];

  const open = !!product && items.length > 0;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="bg-canvas data-[slot=dialog-content]:max-w-[min(960px,calc(100vw-2rem))] sm:max-w-[min(960px,calc(100vw-2rem))]">
        <DialogHeader>
          <DialogTitle className="font-display text-xl text-ink-900">
            Predlog kupovine
          </DialogTitle>
          <DialogDescription className="text-ink-500">
            {product
              ? `Uz „${product.name}" često se kupuje:`
              : "Često se kupuje uz vaš odabir."}
          </DialogDescription>
        </DialogHeader>

        <ul className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2">
          {items.map((p) => {
            const sale = p.salePrice ?? p.fullPrice;
            const onSale = !!p.salePrice && p.salePrice < p.fullPrice;
            return (
              <li
                key={p.sku}
                className="bg-surface ring-border/60 flex w-44 shrink-0 snap-start flex-col overflow-hidden rounded-xl ring-1"
              >
                <Link
                  href={`/p/${p.slug}`}
                  onClick={close}
                  className="relative block aspect-[4/5] overflow-hidden bg-muted-bg"
                >
                  {p.media.images[0] ? (
                    <Image
                      src={p.media.images[0].url}
                      alt={p.media.images[0].alt ?? p.name}
                      fill
                      sizes="176px"
                      className="object-cover"
                    />
                  ) : null}
                </Link>
                <div className="flex flex-1 flex-col gap-1 p-3">
                  <p className="line-clamp-2 text-xs font-medium text-ink-900">
                    {p.name}
                  </p>
                  <div className="mt-auto flex items-baseline gap-1.5 pt-1">
                    <span
                      className={cn(
                        "text-sm font-semibold",
                        onSale ? "text-action" : "text-ink-900",
                      )}
                    >
                      {formatRsd(sale)}
                    </span>
                    {onSale ? (
                      <span className="text-[10px] text-ink-500 line-through">
                        {formatRsd(p.fullPrice)}
                      </span>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={() => commitAddToCart(p)}
                    className="bg-ink-900 hover:bg-walnut focus-visible:ring-walnut/40 mt-2 inline-flex items-center justify-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium text-canvas transition focus-visible:ring-2 focus-visible:outline-none"
                  >
                    <ShoppingBag className="size-3.5" aria-hidden /> Dodaj
                  </button>
                </div>
              </li>
            );
          })}
        </ul>

        <div className="border-border/60 -mx-4 -mb-4 flex justify-end gap-2 border-t bg-muted-bg/40 p-3">
          <button
            type="button"
            onClick={close}
            className="ring-border/60 hover:bg-surface inline-flex items-center rounded-full px-4 py-2 text-xs font-medium text-ink-900 ring-1 transition"
          >
            Nastavi kupovinu
          </button>
          <Link
            href="/korpa"
            onClick={close}
            className="bg-ink-900 hover:bg-walnut inline-flex items-center rounded-full px-4 py-2 text-xs font-medium text-canvas transition"
          >
            Pogledaj korpu
          </Link>
        </div>
      </DialogContent>
    </Dialog>
  );
}
