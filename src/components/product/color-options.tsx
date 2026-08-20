"use client";

import Image from "next/image";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { Product } from "@/types";
import { cn } from "@/lib/utils";
import { getMediaVariantUrl } from "@/lib/media";
import { isProductColorLabel } from "@/lib/product-colors";

const SCROLL_EDGE_EPSILON = 2;

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

export function ProductColorOptions({
  product,
  className,
  label = "Opcije boja",
  showLabels = false,
  selectedSku,
  onSelectSku,
}: {
  product: Product;
  className?: string;
  label?: string;
  showLabels?: boolean;
  selectedSku?: string;
  onSelectSku?: (sku: string) => void;
}) {
  const familyOptions = product.variantFamily?.options ?? [];
  const activeSku = selectedSku ?? product.variantFamily?.selectedSku ?? product.sku;
  const colors = getProductColorOptions(product);
  const railId = useId();
  const railRef = useRef<HTMLDivElement | null>(null);
  const [railState, setRailState] = useState({
    canScrollLeft: false,
    canScrollRight: false,
  });

  const updateRailState = useCallback(() => {
    const rail = railRef.current;
    if (!rail) return;

    const maxScrollLeft = Math.max(0, rail.scrollWidth - rail.clientWidth);
    const next = {
      canScrollLeft: rail.scrollLeft > SCROLL_EDGE_EPSILON,
      canScrollRight:
        maxScrollLeft > SCROLL_EDGE_EPSILON &&
        rail.scrollLeft < maxScrollLeft - SCROLL_EDGE_EPSILON,
    };
    setRailState((current) =>
      current.canScrollLeft === next.canScrollLeft &&
      current.canScrollRight === next.canScrollRight
        ? current
        : next,
    );
  }, []);

  useEffect(() => {
    const rail = railRef.current;
    if (!rail || !familyOptions.length) return;

    const frame = window.requestAnimationFrame(() => {
      const selected = rail.querySelector<HTMLElement>(
        '[data-variant-selected="true"]',
      );
      if (selected) {
        const railRect = rail.getBoundingClientRect();
        const selectedRect = selected.getBoundingClientRect();
        if (selectedRect.left < railRect.left - SCROLL_EDGE_EPSILON) {
          rail.scrollLeft += selectedRect.left - railRect.left;
        } else if (
          selectedRect.right > railRect.right + SCROLL_EDGE_EPSILON
        ) {
          rail.scrollLeft += selectedRect.right - railRect.right;
        }
      }
      updateRailState();
    });

    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(updateRailState);
    resizeObserver?.observe(rail);
    rail
      .querySelectorAll<HTMLElement>("[data-variant-option]")
      .forEach((option) => resizeObserver?.observe(option));
    window.addEventListener("resize", updateRailState);

    return () => {
      window.cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", updateRailState);
    };
  }, [activeSku, familyOptions.length, updateRailState]);

  const scrollVariantRail = useCallback(
    (direction: -1 | 1) => {
      const rail = railRef.current;
      if (!rail) return;

      const railRect = rail.getBoundingClientRect();
      const options = Array.from(
        rail.querySelectorAll<HTMLElement>("[data-variant-option]"),
      );
      const target =
        direction === 1
          ? options.find(
              (option) =>
                option.getBoundingClientRect().right >
                railRect.right + SCROLL_EDGE_EPSILON,
            )
          : [...options]
              .reverse()
              .find(
                (option) =>
                  option.getBoundingClientRect().left <
                  railRect.left - SCROLL_EDGE_EPSILON,
              );
      if (!target) return;

      const targetRect = target.getBoundingClientRect();
      const scrollDelta =
        direction === 1
          ? targetRect.right - railRect.right
          : targetRect.left - railRect.left;
      rail.scrollTo({
        left: rail.scrollLeft + scrollDelta,
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
      });
    },
    [],
  );

  if (familyOptions.length) {
    return (
      <div
        className={cn("grid gap-1.5", className)}
        aria-label={label}
      >
        <div
          className={cn(
            "min-w-0",
            showLabels &&
              "grid gap-1.5 md:grid-cols-[auto_minmax(0,1fr)] md:items-center",
          )}
        >
          {showLabels ? (
            <span className="text-xs font-medium text-ink-500 md:mr-0.5">
              Varijanta:
            </span>
          ) : null}
          <div className="relative min-w-0">
            <div
              id={railId}
              ref={railRef}
              className="flex min-w-0 snap-x snap-proximity flex-nowrap items-center gap-2 overflow-x-auto overscroll-x-contain py-0.5 [touch-action:pan-x_pan-y] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              aria-label="Opcije proizvoda"
              aria-roledescription="carousel"
              data-product-variants
              onScroll={updateRailState}
            >
              {familyOptions.map((option) => {
                const selected = option.sku === activeSku;
                const content = (
                  <>
                    <span
                      className={cn(
                        "relative block overflow-hidden rounded-md bg-[linear-gradient(135deg,#f6f5f1_0_50%,#ebe9e3_50%)]",
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
                  "inline-flex shrink-0 snap-start items-center rounded-lg bg-white transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-walnut",
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
                    data-variant-option
                    data-variant-selected={selected ? "true" : undefined}
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
                    data-variant-option
                    data-variant-selected={selected ? "true" : undefined}
                    className={classes}
                  >
                    {content}
                  </Link>
                );
              })}
            </div>
            {familyOptions.length > 1 ? (
              <>
                <button
                  type="button"
                  aria-label="Prethodna varijanta"
                  aria-controls={railId}
                  hidden={!railState.canScrollLeft}
                  onClick={() => scrollVariantRail(-1)}
                  className="focus-visible:ring-walnut/40 absolute top-1/2 left-0 z-10 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded-full bg-white/95 text-ink-900 shadow-soft-1 ring-1 ring-border/60 transition hover:bg-white focus-visible:ring-2 focus-visible:outline-none"
                >
                  <ChevronLeft className="size-4" aria-hidden />
                </button>
                <button
                  type="button"
                  aria-label="Sledeća varijanta"
                  aria-controls={railId}
                  hidden={!railState.canScrollRight}
                  onClick={() => scrollVariantRail(1)}
                  className="focus-visible:ring-walnut/40 absolute top-1/2 right-0 z-10 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded-full bg-white/95 text-ink-900 shadow-soft-1 ring-1 ring-border/60 transition hover:bg-white focus-visible:ring-2 focus-visible:outline-none"
                >
                  <ChevronRight className="size-4" aria-hidden />
                </button>
              </>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  if (!colors.length) {
    return <div className={cn("h-5", className)} aria-hidden />;
  }

  if (!showLabels) {
    const color = colors[0]!;
    return (
      <div
        className={cn("flex min-h-5 items-center gap-1.5", className)}
        aria-label={`${label}: ${color.label}`}
        data-product-colors
      >
        {color.colors.map((hex, index) => (
          <span
            key={`${hex}-${index}`}
            className="size-3.5 rounded-full ring-1 ring-black/15"
            style={{ backgroundColor: hex }}
            aria-hidden
          />
        ))}
        <span className="truncate text-[11px] font-medium text-ink-500">
          {color.label}
        </span>
      </div>
    );
  }

  const color = colors[0]!;
  const thumbnail = product.media?.images?.[0];

  return (
    <div
      className={cn("grid gap-1.5", className)}
      aria-label={label}
    >
      <div className="grid gap-1.5 md:grid-cols-[auto_minmax(0,1fr)] md:items-center">
        <span className="text-xs font-medium text-ink-500 md:mr-0.5">
          Varijanta:
        </span>
        <span
          className="inline-flex w-fit items-center gap-2 rounded-lg bg-white p-1.5 pr-2.5 ring-2 ring-brand-blue"
          data-variant-option
          data-variant-selected="true"
        >
          <span
            className="relative block size-14 overflow-hidden rounded-md bg-[linear-gradient(135deg,#f6f5f1_0_50%,#ebe9e3_50%)]"
            data-variant-thumbnail
          >
            {thumbnail ? (
              <Image
                src={getMediaVariantUrl(thumbnail, "thumb")}
                alt=""
                fill
                sizes="56px"
                className="object-contain p-0.5"
              />
            ) : (
              <span
                className="absolute inset-1 rounded-sm ring-1 ring-black/10"
                style={{ backgroundColor: color.colors[0] }}
              />
            )}
          </span>
          <span className="max-w-28 text-left text-xs font-semibold text-ink-800">
            {color.label}
          </span>
        </span>
      </div>
    </div>
  );
}
