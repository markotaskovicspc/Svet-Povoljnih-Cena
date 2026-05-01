"use client";

import Image from "next/image";
import Link from "next/link";
import { Minus, Plus, Trash2 } from "lucide-react";
import { useCart, type CartLine } from "@/lib/hooks/use-cart";
import { formatRsd } from "@/lib/format";
import { cn } from "@/lib/utils";

interface CartLineRowProps {
  line: CartLine;
  /** Drawer rows are denser than the /korpa table rows. */
  variant?: "drawer" | "page";
  onNavigate?: () => void;
}

export function CartLineRow({
  line,
  variant = "drawer",
  onNavigate,
}: CartLineRowProps) {
  const setQty = useCart((s) => s.setQty);
  const remove = useCart((s) => s.remove);
  const onSale = line.unitPriceSale < line.unitPriceFull;
  const lineTotal = line.unitPriceSale * line.qty;

  return (
    <div
      className={cn(
        "flex gap-3",
        variant === "page" ? "py-4" : "py-3",
      )}
    >
      <Link
        href={`/p/${line.slug}`}
        onClick={onNavigate}
        className={cn(
          "relative shrink-0 overflow-hidden rounded-xl bg-muted-bg",
          variant === "page" ? "size-24 sm:size-28" : "size-16",
        )}
      >
        {line.thumbnailUrl ? (
          <Image
            src={line.thumbnailUrl}
            alt={line.name}
            fill
            sizes={variant === "page" ? "112px" : "64px"}
            className="object-cover"
          />
        ) : null}
      </Link>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <Link
          href={`/p/${line.slug}`}
          onClick={onNavigate}
          className="hover:text-walnut line-clamp-2 text-sm font-medium text-ink-900 transition focus-visible:underline focus-visible:outline-none"
        >
          {line.name}
        </Link>
        <p className="font-mono text-[11px] tracking-tight text-ink-500">
          {line.sku}
        </p>
        <div className="mt-auto flex items-end justify-between gap-2 pt-1">
          <div
            role="group"
            aria-label="Količina"
            className="bg-canvas ring-border/60 inline-flex items-center overflow-hidden rounded-full ring-1"
          >
            <button
              type="button"
              onClick={() => setQty(line.sku, line.qty - 1)}
              aria-label="Smanji količinu"
              className="hover:bg-muted-bg focus-visible:ring-walnut/40 inline-flex size-7 items-center justify-center text-ink-700 transition focus-visible:ring-2 focus-visible:outline-none"
            >
              <Minus className="size-3.5" aria-hidden />
            </button>
            <span className="min-w-6 text-center text-xs font-medium tabular-nums text-ink-900">
              {line.qty}
            </span>
            <button
              type="button"
              onClick={() => setQty(line.sku, line.qty + 1)}
              aria-label="Povećaj količinu"
              className="hover:bg-muted-bg focus-visible:ring-walnut/40 inline-flex size-7 items-center justify-center text-ink-700 transition focus-visible:ring-2 focus-visible:outline-none"
            >
              <Plus className="size-3.5" aria-hidden />
            </button>
          </div>
          <div className="text-right">
            <div
              className={cn(
                "text-sm font-semibold",
                onSale ? "text-action" : "text-ink-900",
              )}
            >
              {formatRsd(lineTotal)}
            </div>
            {onSale ? (
              <div className="text-[11px] text-ink-500 line-through">
                {formatRsd(line.unitPriceFull * line.qty)}
              </div>
            ) : null}
          </div>
        </div>
      </div>
      <button
        type="button"
        onClick={() => remove(line.sku)}
        aria-label="Ukloni iz korpe"
        className="hover:text-action focus-visible:ring-walnut/40 inline-flex size-8 shrink-0 items-center justify-center rounded-full text-ink-500 transition focus-visible:ring-2 focus-visible:outline-none"
      >
        <Trash2 className="size-4" aria-hidden />
      </button>
    </div>
  );
}
