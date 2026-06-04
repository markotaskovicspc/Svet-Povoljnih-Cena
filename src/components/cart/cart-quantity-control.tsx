"use client";

import { Minus, Plus, ShoppingBag } from "lucide-react";
import type { SKU } from "@/types";
import { useCart, MAX_CART_QTY } from "@/lib/hooks/use-cart";
import { cn } from "@/lib/utils";

interface CartQuantityControlProps {
  sku: SKU;
  quantity: number;
  onAdd?: () => void;
  addLabel?: string;
  className?: string;
  size?: "sm" | "md";
  tone?: "light" | "dark";
  addTone?: "light" | "dark";
  fullWidth?: boolean;
  addDisabled?: boolean;
}

export function CartQuantityControl({
  sku,
  quantity,
  onAdd,
  addLabel = "Dodaj u korpu",
  className,
  size = "sm",
  tone = "light",
  addTone = tone,
  fullWidth = false,
  addDisabled = false,
}: CartQuantityControlProps) {
  const setQty = useCart((s) => s.setQty);
  const qty = Math.min(
    MAX_CART_QTY,
    Math.max(0, Number.isFinite(quantity) ? Math.floor(quantity) : 0),
  );
  const decrementRemoves = qty <= 1;
  const buttonSize = size === "md" ? "size-9" : "size-7";
  const iconSize = size === "md" ? "size-4" : "size-3.5";
  const stepperText = size === "md" ? "text-sm min-w-7" : "text-xs min-w-6";

  if (qty <= 0) {
    if (!onAdd) return null;

    return (
      <button
        type="button"
        onClick={onAdd}
        disabled={addDisabled}
        className={cn(
          "focus-visible:ring-walnut/40 inline-flex items-center justify-center gap-1.5 rounded-full font-medium transition focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-45",
          size === "md" ? "h-10 px-4 text-sm" : "h-9 px-3 text-xs",
          fullWidth && "w-full",
          addTone === "dark"
            ? "bg-ink-900 text-canvas hover:bg-walnut"
            : "bg-canvas text-ink-900 ring-1 ring-border/60 hover:bg-muted-bg",
          className,
        )}
      >
        <ShoppingBag className={iconSize} aria-hidden />
        <span className="whitespace-nowrap">{addLabel}</span>
      </button>
    );
  }

  return (
    <div
      role="group"
      aria-label="Količina u korpi"
      className={cn(
        "inline-flex items-center justify-between overflow-hidden rounded-full",
        size === "md" ? "h-10" : "h-9",
        fullWidth && "w-full",
        tone === "dark"
          ? "bg-ink-900 text-canvas"
          : "bg-canvas text-ink-900 ring-1 ring-border/60",
        className,
      )}
    >
      <button
        type="button"
        onClick={() => setQty(sku, qty - 1)}
        aria-label={decrementRemoves ? "Ukloni iz korpe" : "Smanji količinu"}
        title={decrementRemoves ? "Ukloni iz korpe" : "Smanji količinu"}
        className={cn(
          "focus-visible:ring-walnut/40 inline-flex items-center justify-center transition focus-visible:ring-2 focus-visible:outline-none",
          buttonSize,
          tone === "dark"
            ? "hover:bg-walnut text-canvas"
            : "hover:bg-muted-bg text-ink-700",
        )}
      >
        <Minus className={iconSize} aria-hidden />
      </button>
      <span
        aria-live="polite"
        className={cn("text-center font-medium tabular-nums", stepperText)}
      >
        {qty}
      </span>
      <button
        type="button"
        onClick={() => setQty(sku, qty + 1)}
        disabled={qty >= MAX_CART_QTY}
        aria-label="Povećaj količinu"
        className={cn(
          "focus-visible:ring-walnut/40 inline-flex items-center justify-center transition focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40",
          buttonSize,
          tone === "dark"
            ? "hover:bg-walnut text-canvas"
            : "hover:bg-muted-bg text-ink-700",
        )}
      >
        <Plus className={iconSize} aria-hidden />
      </button>
    </div>
  );
}
