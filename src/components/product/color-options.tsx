"use client";

import type { Product } from "@/types";
import { cn } from "@/lib/utils";

const COLOR_HEX: Record<string, string> = {
  bela: "#f8f7f2",
  crna: "#181716",
  siva: "#9ca3af",
  silver: "#b8bec6",
  srebrna: "#b8bec6",
  plava: "#2f6fcb",
  "svetlo plava": "#8fc6e8",
  zelena: "#4f8b57",
  crvena: "#c83a31",
  braon: "#8a5a3c",
  krem: "#e7dac5",
  roze: "#e8a6b6",
  zuta: "#f4c542",
  žuta: "#f4c542",
  ljubičasta: "#7c4d9f",
  ljubicasta: "#7c4d9f",
  narandžasta: "#e9782e",
  narandzasta: "#e9782e",
  zlatna: "#c8a24a",
  providna: "#e9f1f5",
  staklena: "#dbeafe",
  natur: "#c7a36f",
};

export type ProductColorOption = {
  label: string;
  hex: string;
};

export function getProductColorOptions(product: Product): ProductColorOption[] {
  const seen = new Set<string>();
  return [product.colorPrimary, product.colorSecondary]
    .filter((color): color is string => Boolean(color?.trim()))
    .map((label) => label.trim())
    .filter((label) => {
      const key = label.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((label) => ({
      label,
      hex: COLOR_HEX[label.toLowerCase()] ?? "#d8d4c8",
    }));
}

export function ProductColorOptions({
  product,
  className,
  label = "Opcije boja",
  max = 4,
  showLabels = false,
}: {
  product: Product;
  className?: string;
  label?: string;
  max?: number;
  showLabels?: boolean;
}) {
  const colors = getProductColorOptions(product);

  if (!colors.length) {
    return <div className={cn("h-5", className)} aria-hidden />;
  }

  return (
    <div
      className={cn("flex flex-wrap items-center gap-1.5", className)}
      aria-label={label}
    >
      {showLabels ? (
        <span className="mr-0.5 text-xs font-medium text-ink-500">Boja:</span>
      ) : null}
      {colors.slice(0, max).map((color) => (
        <span
          key={color.label}
          title={color.label}
          className={cn(
            "inline-flex shrink-0 items-center rounded-full",
            showLabels ? "gap-1.5 bg-muted-bg px-2 py-1" : "size-3.5",
          )}
        >
          <span
            className={cn(
              "shrink-0 rounded-full ring-1 ring-black/10",
              showLabels ? "size-3.5" : "size-full",
            )}
            style={{ backgroundColor: color.hex }}
          />
          {showLabels ? (
            <span className="text-xs font-semibold text-ink-800">
              {color.label}
            </span>
          ) : null}
        </span>
      ))}
    </div>
  );
}
