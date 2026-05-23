"use client";

import { useMemo, useState } from "react";
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
  selectable = false,
  label = "Opcije boja",
  max = 4,
}: {
  product: Product;
  className?: string;
  selectable?: boolean;
  label?: string;
  max?: number;
}) {
  const colors = useMemo(() => getProductColorOptions(product), [product]);
  const [selected, setSelected] = useState(colors[0]?.label ?? "");

  if (!colors.length) {
    return <div className={cn("h-5", className)} aria-hidden />;
  }

  return (
    <div className={cn("flex items-center gap-1", className)} aria-label={label}>
      {colors.slice(0, max).map((color) => {
        const active = selectable && selected === color.label;
        return (
          <button
            key={color.label}
            type="button"
            title={color.label}
            aria-label={color.label}
            aria-pressed={selectable ? active : undefined}
            onClick={selectable ? () => setSelected(color.label) : undefined}
            disabled={!selectable}
            className={cn(
              "ring-border inline-flex shrink-0 rounded-full ring-1 transition",
              selectable
                ? "size-7 items-center justify-center bg-white hover:ring-walnut focus-visible:ring-2 focus-visible:ring-walnut/40 focus-visible:outline-none"
                : "size-3.5",
              active && "ring-walnut ring-2",
            )}
          >
            <span
              className={cn(
                "rounded-full ring-1 ring-black/10",
                selectable ? "size-[18px]" : "size-full",
              )}
              style={{ backgroundColor: color.hex }}
            />
          </button>
        );
      })}
    </div>
  );
}
