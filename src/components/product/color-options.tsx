"use client";

import Image from "next/image";
import Link from "next/link";
import type { Product } from "@/types";
import { cn } from "@/lib/utils";
import { getMediaVariantUrl } from "@/lib/media";
import { isProductColorLabel } from "@/lib/product-colors";

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
  colors: string[];
};

export function getProductColorOptions(product: Product): ProductColorOption[] {
  const seen = new Set<string>();
  const labels = [product.colorPrimary, product.colorSecondary]
    .filter((color): color is string => isProductColorLabel(color))
    .map((label) => label.trim().toLocaleUpperCase("sr-Latn-RS"))
    .filter((label) => {
      const key = label.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  return labels.length
    ? [{
        label: labels.join(" / "),
        colors: labels.map(
          (label) => COLOR_HEX[label.toLowerCase()] ?? "#d8d4c8",
        ),
      }]
    : [];
}

function colorSwatchStyle(colors: string[]) {
  const uniqueColors = Array.from(new Set(colors.filter(Boolean)));
  if (uniqueColors.length < 2) {
    return { backgroundColor: uniqueColors[0] ?? "#d8d4c8" };
  }
  return {
    backgroundImage: `linear-gradient(90deg, ${uniqueColors[0]} 0 50%, ${uniqueColors[1]} 50% 100%)`,
  };
}

function ColorSwatch({ colors, className }: { colors: string[]; className?: string }) {
  return (
    <span
      aria-hidden
      data-color-count={Math.min(new Set(colors).size, 2)}
      className={cn(
        "shrink-0 rounded-full ring-1 ring-black/15",
        className,
      )}
      style={colorSwatchStyle(colors)}
    />
  );
}

function ProductColorDisplay({
  colors,
  label,
  showLabels,
}: {
  colors: ProductColorOption[];
  label: string;
  showLabels: boolean;
}) {
  if (!colors.length) return null;

  const color = colors[0]!;
  return (
    <div
      className="flex flex-wrap items-center gap-1.5"
      aria-label={label}
      data-product-colors
    >
      {showLabels ? (
        <span className="mr-0.5 text-xs font-medium text-ink-500">Boja:</span>
      ) : null}
      <span
        title={color.label}
        className={cn(
          "inline-flex shrink-0 items-center rounded-full",
          showLabels ? "gap-1.5 bg-muted-bg px-2 py-1" : "size-3.5",
        )}
      >
        <ColorSwatch
          colors={color.colors}
          className={showLabels ? "size-3.5" : "size-full"}
        />
        {showLabels ? (
          <span className="text-xs font-semibold text-ink-800">
            {color.label}
          </span>
        ) : null}
      </span>
    </div>
  );
}

export function ProductColorOptions({
  product,
  className,
  label = "Opcije boja",
  max = 4,
  showLabels = false,
  selectedSku,
  onSelectSku,
}: {
  product: Product;
  className?: string;
  label?: string;
  max?: number;
  showLabels?: boolean;
  selectedSku?: string;
  onSelectSku?: (sku: string) => void;
}) {
  const familyOptions = product.variantFamily?.options ?? [];
  const activeSku = selectedSku ?? product.variantFamily?.selectedSku ?? product.sku;
  const colors = getProductColorOptions(product);

  if (familyOptions.length) {
    const visibleOptions = familyOptions.slice(0, max);
    return (
      <div className={cn("grid gap-1.5", className)}>
        <div
          className="flex flex-wrap items-center gap-2"
          aria-label="Opcije proizvoda"
          data-product-variants
        >
          {showLabels ? (
            <span className="basis-full text-xs font-medium text-ink-500 md:mr-0.5 md:basis-auto">
              Varijanta:
            </span>
          ) : null}
          {visibleOptions.map((option) => {
            const selected = option.sku === activeSku;
            const content = (
              <>
                <span
                  className={cn(
                    "relative block overflow-hidden rounded-md bg-white",
                    showLabels ? "size-14" : "size-9",
                  )}
                  data-variant-thumbnail
                >
                  {option.thumbnail ? (
                    <Image
                      src={getMediaVariantUrl(option.thumbnail, "thumb")}
                      alt=""
                      fill
                      sizes={showLabels ? "56px" : "36px"}
                      className="object-contain p-0.5"
                    />
                  ) : (
                    <span
                      className="absolute inset-1 rounded-sm ring-1 ring-black/10"
                      style={{
                        backgroundColor:
                          option.colorHex ??
                          COLOR_HEX[option.label.toLowerCase()] ??
                          "#d8d4c8",
                      }}
                    />
                  )}
                </span>
                {showLabels ? (
                  <span className="max-w-28 text-left text-xs font-semibold text-ink-800">
                    {option.label}
                  </span>
                ) : null}
              </>
            );
            const classes = cn(
              "inline-flex shrink-0 items-center rounded-lg bg-white transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-walnut",
              showLabels ? "gap-2 p-1.5 pr-2.5" : "p-0.5",
              selected
                ? "ring-2 ring-brand-blue"
                : "ring-1 ring-border hover:ring-ink-500",
            );
            const ariaLabel = `${option.label} — SKU ${option.sku}`;
            return onSelectSku ? (
              <button
                key={option.sku}
                type="button"
                aria-label={ariaLabel}
                aria-pressed={selected}
                title={option.label}
                onClick={() => onSelectSku(option.sku)}
                className={classes}
              >
                {content}
              </button>
            ) : (
              <Link
                key={option.sku}
                href={`/p/${option.slug}`}
                aria-label={ariaLabel}
                aria-current={selected ? "page" : undefined}
                title={option.label}
                className={classes}
              >
                {content}
              </Link>
            );
          })}
          {familyOptions.length > visibleOptions.length ? (
            <span className="text-xs font-semibold text-ink-500">
              +{familyOptions.length - visibleOptions.length}
            </span>
          ) : null}
        </div>
        <ProductColorDisplay
          colors={colors}
          label={label}
          showLabels={showLabels}
        />
      </div>
    );
  }

  if (!colors.length) {
    return <div className={cn("h-5", className)} aria-hidden />;
  }

  return (
    <div className={className}>
      <ProductColorDisplay
        colors={colors}
        label={label}
        showLabels={showLabels}
      />
    </div>
  );
}
