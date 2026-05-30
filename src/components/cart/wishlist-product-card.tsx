"use client";

import Image from "next/image";
import Link from "next/link";
import { Bell, BellOff, ShoppingBag, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { WishlistEntry } from "@/lib/hooks/use-wishlist";
import { useCart } from "@/lib/hooks/use-cart";
import { cn } from "@/lib/utils";
import { formatRsd } from "@/lib/format";

export function WishlistProductCard({
  entry,
  compact = false,
  onRemove,
  onNotifyChange,
  onNavigate,
}: {
  entry: WishlistEntry;
  compact?: boolean;
  onRemove: () => void;
  onNotifyChange: (
    key: "notifyOnSale" | "notifyOnRestock",
    value: boolean,
  ) => void;
  onNavigate?: () => void;
}) {
  const add = useCart((s) => s.add);
  const product = entry.product;
  const name = product?.name ?? "Sačuvan proizvod";
  const href = product?.slug ? `/p/${product.slug}` : undefined;
  const effectivePrice = product?.effectivePrice ?? product?.fullPrice;
  const hasReducedPrice =
    product?.effectivePrice != null &&
    product.fullPrice != null &&
    product.effectivePrice < product.fullPrice;

  function addToCart() {
    if (!product?.name || !product.effectivePrice || !product.fullPrice || !product.slug) {
      toast.error("Podaci o proizvodu se još učitavaju.");
      return;
    }
    add({
      sku: entry.sku,
      name: product.name,
      slug: product.slug,
      unitPriceFull: product.fullPrice,
      unitPriceSale: product.effectivePrice,
      thumbnailUrl: product.thumbnailUrl ?? undefined,
    });
    toast.success("Dodato u korpu");
  }

  const media = (
    <span
      className={cn(
        "relative block shrink-0 overflow-hidden rounded-lg bg-white ring-1 ring-border/60",
        compact ? "size-20" : "aspect-square w-full",
      )}
    >
      {product?.thumbnailUrl ? (
        <Image
          src={product.thumbnailUrl}
          alt={name}
          fill
          sizes={compact ? "80px" : "(min-width: 1024px) 25vw, 50vw"}
          className="object-contain p-2"
        />
      ) : null}
    </span>
  );

  return (
    <article
      className={cn(
        "bg-surface ring-border/60 overflow-hidden rounded-lg ring-1 shadow-soft-1",
        compact ? "flex gap-3 p-3" : "flex h-full flex-col",
      )}
    >
      {href ? (
        <Link href={href} onClick={onNavigate} className={compact ? "shrink-0" : "block"}>
          {media}
        </Link>
      ) : (
        media
      )}

      <div className={cn("flex min-w-0 flex-1 flex-col", compact ? "gap-2" : "gap-3 p-4")}>
        <div className="min-w-0">
          {href ? (
            <Link
              href={href}
              onClick={onNavigate}
              className="line-clamp-2 text-sm font-semibold text-ink-900 transition hover:text-walnut"
            >
              {name}
            </Link>
          ) : (
            <p className="line-clamp-2 text-sm font-semibold text-ink-900">{name}</p>
          )}
          <p className="mt-0.5 font-mono text-[11px] text-ink-500">SKU {entry.sku}</p>
        </div>

        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            {effectivePrice != null ? (
              <p className="text-sm font-bold text-action tabular-nums">
                {formatRsd(effectivePrice)}
              </p>
            ) : (
              <p className="text-xs text-ink-500">Učitavanje cene</p>
            )}
            {hasReducedPrice ? (
              <p className="text-[11px] text-ink-500 line-through tabular-nums">
                {formatRsd(product.fullPrice!)}
              </p>
            ) : null}
          </div>
          <span
            className={cn(
              "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium",
              product?.inStock
                ? "bg-success/10 text-success"
                : "bg-muted-bg text-ink-500",
            )}
          >
            {product?.inStock ? "Na stanju" : product?.incoming ? "U dolasku" : "Proveravamo"}
          </span>
        </div>

        <div className="mt-auto flex flex-wrap gap-1.5">
          <NotifyToggle
            label={compact ? "Akcija" : "Obavesti za akciju"}
            active={!!entry.notifyOnSale}
            onClick={() => onNotifyChange("notifyOnSale", !entry.notifyOnSale)}
          />
          <NotifyToggle
            label={compact ? "Stanje" : "Obavesti za stanje"}
            active={!!entry.notifyOnRestock}
            onClick={() => onNotifyChange("notifyOnRestock", !entry.notifyOnRestock)}
          />
        </div>

        <div className="flex items-center gap-2 border-t border-border/60 pt-3">
          <button
            type="button"
            onClick={addToCart}
            disabled={!product?.inStock}
            className="bg-ink-900 hover:bg-walnut focus-visible:ring-walnut/40 inline-flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-full px-3 text-xs font-medium text-canvas transition focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-45"
          >
            <ShoppingBag className="size-3.5" aria-hidden />
            Dodaj
          </button>
          <button
            type="button"
            onClick={onRemove}
            aria-label="Ukloni iz liste želja"
            className="hover:text-action focus-visible:ring-walnut/40 inline-flex size-9 items-center justify-center rounded-full text-ink-500 transition focus-visible:ring-2 focus-visible:outline-none"
          >
            <Trash2 className="size-4" aria-hidden />
          </button>
        </div>
      </div>
    </article>
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
