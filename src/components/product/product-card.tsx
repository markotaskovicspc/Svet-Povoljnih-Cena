"use client";

/**
 * Product card — Phase 1C polish.
 * Adds: horizontal image rail, image badges,
 * qty-stepper morph from "Dodaj u korpu" button when item is in cart, blur placeholder,
 * skeleton loading variant, reduced-motion friendly micro-interactions.
 */
import Image from "next/image";
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { Heart, Minus, Plus, ShoppingBag } from "lucide-react";
import type { Product } from "@/types";
import { cn } from "@/lib/utils";
import { formatRsd, formatDate } from "@/lib/format";
import { useWishlist, useIsWished } from "@/lib/hooks/use-wishlist";
import { useCart } from "@/lib/hooks/use-cart";
import { commitAddToCart } from "@/components/cart/add-to-cart-action";
import { ProductColorOptions } from "@/components/product/color-options";
import {
  deriveImageBadges,
  effectiveUnitPrice,
  type Badge,
  type BadgeTone,
} from "@/lib/pricing";

interface ProductCardProps {
  product: Product;
  className?: string;
  /** Used to size the next/image inside snap rails. */
  priority?: boolean;
}

/** 8×10 warm-ivory blur placeholder; matches bg-muted. */
const FALLBACK_BLUR =
  "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA4IDEwIj48cmVjdCB3aWR0aD0iOCIgaGVpZ2h0PSIxMCIgZmlsbD0iI2YxZWNlMyIvPjwvc3ZnPg==";

const toneClasses: Record<BadgeTone, string> = {
  action: "bg-action text-white",
  gold: "bg-sand text-ink-900",
  olive: "bg-olive text-white",
  amber: "bg-warning text-ink-900",
  red: "bg-action/10 text-action ring-1 ring-action/30",
  ink: "bg-ink-900 text-canvas",
  protected: "bg-brand-blue text-white",
};

const HEROJI_MESECA_MARK_SRC = "/brand/heroji-meseca.png";

export function ProductCard({ product, className, priority }: ProductCardProps) {
  const reduced = useReducedMotion();
  const wished = useIsWished(product.sku);
  const toggleWish = useWishlist((s) => s.toggle);
  const setQty = useCart((s) => s.setQty);
  const lineQty = useCart(
    (s) => s.lines.find((l) => l.sku === product.sku)?.qty ?? 0,
  );

  const images = product.media.images;
  const cover = images[0];
  const imageBadges = deriveImageBadges(product);
  const price = effectiveUnitPrice(product);
  const hasReducedPrice = price.effective < price.full;

  const hoverProps = reduced ? {} : { whileHover: { y: -6, rotate: -1 } };

  function handleAdd() {
    commitAddToCart(product);
  }

  return (
    <motion.article
      {...hoverProps}
      transition={{ type: "spring", stiffness: 220, damping: 22 }}
      className={cn(
        "group bg-white text-ink-900 ring-border/60 relative flex flex-col overflow-hidden rounded-2xl shadow-soft-2 ring-1 transition hover:shadow-soft-3",
        className,
      )}
    >
      <Link
        href={`/p/${product.slug}`}
        aria-label={`${product.name} — pregled proizvoda`}
        className="focus-visible:ring-walnut/40 relative block aspect-[4/5] overflow-hidden bg-white focus-visible:ring-2 focus-visible:outline-none"
      >
        {images.length > 1 ? (
          <div className="flex h-full snap-x snap-mandatory overflow-x-auto bg-white [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {images.map((image, index) => (
              <span
                key={`${image.url}-${index}`}
                className="relative block h-full min-w-full snap-center"
              >
                <Image
                  src={image.url}
                  alt={image.alt ?? product.name}
                  fill
                  sizes="(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 48vw"
                  priority={priority && index === 0}
                  placeholder="blur"
                  blurDataURL={image.blurDataUrl ?? FALLBACK_BLUR}
                  className="object-contain p-3"
                />
              </span>
            ))}
          </div>
        ) : null}
        {/*
         * `layoutId` bridges this image to the PDP hero image (Phase 1H.2).
         * Framer Motion morphs between the two when navigating to /p/[slug],
         * thanks to AnimatePresence in app/template.tsx.
         */}
        <motion.div
          layoutId={`product-cover-${product.sku}`}
          className={cn("absolute inset-0", images.length > 1 && "hidden")}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        >
          {cover ? (
            <Image
              src={cover.url}
              alt={cover.alt ?? product.name}
              fill
              sizes="(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 48vw"
              priority={priority}
              placeholder="blur"
              blurDataURL={cover.blurDataUrl ?? FALLBACK_BLUR}
              className="object-contain p-3 transition duration-700 ease-[cubic-bezier(0.22,1,0.36,1)]"
            />
          ) : null}
        </motion.div>
        {/* Soft floor gradient */}
        <div
          aria-hidden
          className="from-ink-900/12 pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t to-transparent"
        />
        {imageBadges.topLeft.length ? (
          <div className="pointer-events-none absolute top-2 left-2 flex max-w-[80%] flex-col items-start gap-1 md:top-3 md:left-3">
            {imageBadges.topLeft.map((b) => (
              <ProductBadge key={b.key} badge={b} />
            ))}
          </div>
        ) : null}
        {imageBadges.bottomLeft.length ? (
          <div className="pointer-events-none absolute bottom-2 left-2 flex max-w-[80%] flex-col items-start gap-1 md:bottom-3 md:left-3">
            {imageBadges.bottomLeft.map((b) => (
              <ProductBadge key={b.key} badge={b} />
            ))}
          </div>
        ) : null}
      </Link>

      {/* Wishlist heart */}
      <button
        type="button"
        aria-pressed={wished}
        aria-label={wished ? "Ukloni iz liste želja" : "Dodaj u listu želja"}
        onClick={() => toggleWish(product.sku)}
        className="bg-surface/85 ring-border/60 hover:text-action focus-visible:ring-walnut/40 absolute top-3 right-3 inline-flex size-9 items-center justify-center rounded-full text-ink-700 ring-1 backdrop-blur transition focus-visible:ring-2 focus-visible:outline-none"
      >
        <Heart
          className={cn("size-4 transition", wished && "fill-action text-action")}
          aria-hidden
        />
      </button>

      {/* Body */}
      <div className="flex flex-1 flex-col gap-0.5 px-2.5 pt-2.5 pb-2 md:gap-2 md:px-4 md:pt-4 md:pb-3">
        <h3 className="line-clamp-2 text-xs leading-snug font-medium text-ink-900 md:text-sm">
          <Link
            href={`/p/${product.slug}`}
            className="hover:text-walnut transition focus-visible:underline focus-visible:outline-none"
          >
            {product.name}
          </Link>
        </h3>
        <ProductColorOptions product={product} className="h-5 pt-0.5" />

        <div className="pt-0 md:mt-auto md:pt-1">
          <div className="flex items-end justify-between gap-2 md:flex-col md:items-stretch">
            <div className="min-w-0 flex flex-1 flex-wrap items-baseline gap-x-1.5 gap-y-1 md:gap-x-2 md:gap-y-0.5">
              {hasReducedPrice ? (
                <>
                  <span className="text-action text-sm font-bold md:text-base">
                    {formatRsd(price.effective)}
                  </span>
                  <span className="text-[10px] text-ink-500 line-through md:text-xs">
                    {formatRsd(price.full)}
                  </span>
                </>
              ) : (
                <span className="text-sm font-semibold text-ink-900 md:text-base">
                  {formatRsd(price.full)}
                </span>
              )}
            </div>
            <MobileCartControl
              lineQty={lineQty}
              className="w-[92px] shrink-0 min-[390px]:w-[104px] md:w-full"
              onAdd={handleAdd}
              onDecrease={() => setQty(product.sku, lineQty - 1)}
              onIncrease={() => setQty(product.sku, lineQty + 1)}
            />
          </div>
          {price.kind === "sale" && product.action?.isPermanent ? (
            <p className="mt-0.5 hidden text-[11px] text-ink-500 md:block">
              Cena pod trajnom zaštitom · Isporuka {product.deliveryDays.min}–
              {product.deliveryDays.max} dana
            </p>
          ) : price.kind === "sale" && product.action?.endsAt ? (
            <p className="mt-0.5 hidden text-[11px] text-ink-500 md:block">
              Akcija do {formatDate(product.action.endsAt)} · Isporuka{" "}
              {product.deliveryDays.min}–{product.deliveryDays.max} dana
            </p>
          ) : (
            <p className="mt-0.5 hidden text-[11px] text-ink-500 md:block">
              Isporuka {product.deliveryDays.min}–{product.deliveryDays.max} dana
            </p>
          )}
        </div>
      </div>

    </motion.article>
  );
}

function ProductBadge({ badge }: { badge: Badge }) {
  if (badge.key === "hero") {
    return (
      <span
        aria-label={badge.label}
        className="bg-surface/95 ring-border/70 rounded-full px-1.5 py-1 shadow-soft-1 ring-1 backdrop-blur"
      >
        <Image
          src={HEROJI_MESECA_MARK_SRC}
          alt={badge.label}
          width={44}
          height={37}
          className="h-7 w-8 object-contain md:h-8 md:w-10"
        />
      </span>
    );
  }

  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-[10px] leading-none font-medium tracking-tight shadow-soft-1 md:px-2.5 md:py-1 md:text-[11px]",
        toneClasses[badge.tone],
      )}
    >
      {badge.label}
    </span>
  );
}

function MobileCartControl({
  lineQty,
  className,
  onAdd,
  onDecrease,
  onIncrease,
}: {
  lineQty: number;
  className?: string;
  onAdd: () => void;
  onDecrease: () => void;
  onIncrease: () => void;
}) {
  return (
    <div className={cn("w-full", className)}>
      {lineQty > 0 ? (
        <div
          className="bg-ink-900 inline-flex h-10 w-full items-center justify-between overflow-hidden rounded-full text-canvas"
          role="group"
          aria-label="Količina u korpi"
        >
          <button
            type="button"
            onClick={onDecrease}
            aria-label="Smanji količinu"
            className="hover:bg-walnut focus-visible:ring-walnut/40 inline-flex size-7 items-center justify-center transition focus-visible:ring-2 focus-visible:outline-none"
          >
            <Minus className="size-3.5" aria-hidden />
          </button>
          <span
            aria-live="polite"
            className="min-w-5 text-center text-xs font-medium tabular-nums"
          >
            {lineQty}
          </span>
          <button
            type="button"
            onClick={onIncrease}
            aria-label="Povećaj količinu"
            className="hover:bg-walnut focus-visible:ring-walnut/40 inline-flex size-7 items-center justify-center transition focus-visible:ring-2 focus-visible:outline-none"
          >
            <Plus className="size-3.5" aria-hidden />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={onAdd}
          className="bg-ink-900 hover:bg-walnut focus-visible:ring-walnut/40 inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-full px-2 text-xs font-medium text-canvas transition focus-visible:ring-2 focus-visible:outline-none md:px-3"
        >
          <ShoppingBag className="size-3.5 shrink-0" aria-hidden />
          <span className="md:hidden">Dodaj</span>
          <span className="hidden md:inline">Dodaj u korpu</span>
        </button>
      )}
    </div>
  );
}

/**
 * Skeleton variant for loading states (suspense fallbacks, prefetching).
 * Mirrors the card geometry to avoid layout shift.
 */
export function ProductCardSkeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        "bg-white ring-border/60 relative flex animate-pulse flex-col overflow-hidden rounded-2xl shadow-soft-1 ring-1",
        className,
      )}
    >
      <div className="aspect-[4/5] bg-muted-bg" />
      <div className="flex flex-1 flex-col gap-2 px-4 pt-4 pb-3">
        <div className="h-3.5 w-4/5 rounded-full bg-muted-bg" />
        <div className="h-3.5 w-2/5 rounded-full bg-muted-bg" />
        <div className="h-2.5 w-1/3 rounded-full bg-muted-bg/70" />
        <div className="mt-auto flex items-baseline gap-2 pt-3">
          <div className="h-4 w-20 rounded-full bg-muted-bg" />
          <div className="h-3 w-12 rounded-full bg-muted-bg/70" />
        </div>
      </div>
      <div className="border-border/60 flex items-center justify-between gap-2 border-t px-4 py-3">
        <div className="h-2.5 w-16 rounded-full bg-muted-bg/70" />
        <div className="h-7 w-16 rounded-full bg-muted-bg" />
      </div>
    </div>
  );
}
