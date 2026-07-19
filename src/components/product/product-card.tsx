"use client";

/**
 * Product card — Phase 1C polish.
 * Adds: image badges, qty-stepper morph from "Dodaj u korpu" button when item is in cart, blur placeholder,
 * skeleton loading variant, reduced-motion friendly micro-interactions.
 */
import Image from "next/image";
import Link from "next/link";
import { useCallback, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { ChevronLeft, ChevronRight, Heart, PackageSearch } from "lucide-react";
import type { Product } from "@/types";
import { cn } from "@/lib/utils";
import { formatRsd, formatDate } from "@/lib/format";
import { getMediaVariantUrl, isRenderableImageUrl } from "@/lib/media";
import { getProductAvailability } from "@/lib/product-availability";
import { useWishlist, useIsWished } from "@/lib/hooks/use-wishlist";
import { useCart } from "@/lib/hooks/use-cart";
import { commitAddToCart } from "@/components/cart/add-to-cart-action";
import { CartQuantityControl } from "@/components/cart/cart-quantity-control";
import { ProductColorOptions } from "@/components/product/color-options";
import {
  deriveImageBadges,
  effectiveUnitPrice,
  type Badge,
  type BadgeTone,
} from "@/lib/pricing";
import {
  herojiMesecaIcon,
  protectedPricesIcon,
  type CampaignStickerKey,
} from "@/data/campaign-icons";

interface ProductCardProps {
  product: Product;
  className?: string;
  /** Preload the cover image only when the card image is the route LCP. */
  preload?: boolean;
  /** Contextual promo sticker inherited from the current rail/listing. */
  campaignSticker?: CampaignStickerKey;
}

/** 8×10 white blur placeholder for product media loading states. */
const FALLBACK_BLUR =
  "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA4IDEwIj48cmVjdCB3aWR0aD0iOCIgaGVpZ2h0PSIxMCIgZmlsbD0iI2ZmZmZmZiIvPjwvc3ZnPg==";

const toneClasses: Record<BadgeTone, string> = {
  action: "bg-action text-white",
  gold: "bg-sand text-ink-900",
  olive: "bg-olive text-white",
  amber: "bg-warning text-ink-900",
  red: "bg-action/10 text-action ring-1 ring-action/30",
  ink: "bg-ink-900 text-canvas",
  protected: "bg-brand-blue text-white",
};

export function ProductCard({
  product,
  className,
  preload,
}: ProductCardProps) {
  const reduced = useReducedMotion();
  const wished = useIsWished(product.sku);
  const toggleWish = useWishlist((s) => s.toggleProduct);
  const cartHydrated = useCart((s) => s.hydrated);
  const lineQty = useCart(
    (s) => s.lines.find((l) => l.sku === product.sku)?.qty ?? 0,
  );
  const visibleLineQty = cartHydrated ? lineQty : 0;

  const [failedImageUrls, setFailedImageUrls] = useState<string[]>([]);
  const images = useMemo(
    () =>
      product.media.images
        .map((image) => ({
          ...image,
          url: getMediaVariantUrl(image, "card"),
        }))
        .filter(
          (image) =>
            isRenderableImageUrl(image.url) && !failedImageUrls.includes(image.url),
        ),
    [failedImageUrls, product.media.images],
  );
  const imageTrackRef = useRef<HTMLDivElement | null>(null);
  const imageDragRef = useRef({
    pointerId: -1,
    startX: 0,
    scrollLeft: 0,
    didDrag: false,
  });
  const [activeImage, setActiveImage] = useState(0);
  const imageBadges = deriveImageBadges(product);
  const topLeftBadges = imageBadges.topLeft;
  const bottomLeftBadges = imageBadges.bottomLeft;
  const price = effectiveUnitPrice(product);
  const hasReducedPrice = price.effective < price.full;
  const shortDescription =
    product.shortDescription?.trim() ||
    product.categoryPath.at(-1) ||
    product.group;
  const promoLine = product.action?.isPermanent
    ? "Trajno niska cena"
    : price.kind === "sale" && product.action?.endsAt
      ? `Akcija do ${formatDate(product.action.endsAt)}`
      : "";
  const availability = getProductAvailability(product);

  const hoverProps = reduced ? {} : { whileHover: { y: -6, rotate: -1 } };

  const syncActiveImage = useCallback(() => {
    if (!images.length) return;
    const track = imageTrackRef.current;
    if (!track) return;
    const index = Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
    setActiveImage(Math.max(0, Math.min(index, images.length - 1)));
  }, [images.length]);

  const showImage = useCallback(
    (index: number) => {
      const track = imageTrackRef.current;
      if (!track || !images.length) return;
      const nextIndex = Math.max(0, Math.min(index, images.length - 1));
      track.scrollTo({
        left: nextIndex * track.clientWidth,
        behavior: reduced ? "auto" : "smooth",
      });
      setActiveImage(nextIndex);
    },
    [images.length, reduced],
  );

  const handleImageDragStart = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "touch" && event.button !== 0) return;

    imageDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      scrollLeft: event.currentTarget.scrollLeft,
      didDrag: false,
    };
    if (event.pointerType !== "touch") {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
  }, []);

  const handleImageDragMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = imageDragRef.current;
    if (drag.pointerId !== event.pointerId) return;

    const distance = event.clientX - drag.startX;
    if (Math.abs(distance) > 4) drag.didDrag = true;
    if (drag.didDrag && event.pointerType !== "touch") {
      event.preventDefault();
      event.currentTarget.scrollLeft = drag.scrollLeft - distance;
    }
  }, []);

  const finishImageDrag = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = imageDragRef.current;
      if (drag.pointerId !== event.pointerId) return;

      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      imageDragRef.current.pointerId = -1;
      syncActiveImage();
    },
    [syncActiveImage],
  );

  function handleAdd() {
    if (!availability.canAddToCart) return;
    commitAddToCart(product);
  }

  const markImageFailed = useCallback((url: string) => {
    setFailedImageUrls((current) =>
      current.includes(url) ? current : [...current, url],
    );
  }, []);

  return (
    <motion.article
      {...hoverProps}
      transition={{ type: "spring", stiffness: 220, damping: 22 }}
      className={cn(
        "group bg-white text-ink-900 ring-border/60 relative flex flex-col overflow-hidden rounded-lg shadow-soft-1 ring-1 transition hover:shadow-soft-3",
        className,
      )}
    >
      <div className="relative aspect-square overflow-hidden bg-white">
        <Link
          href={`/p/${product.slug}`}
          aria-label={`${product.name} — pregled proizvoda`}
          onClick={(event) => {
            if (imageDragRef.current.didDrag) event.preventDefault();
          }}
          className="focus-visible:ring-walnut/40 absolute inset-0 block focus-visible:ring-2 focus-visible:outline-none"
        >
        <div
          ref={imageTrackRef}
          onScroll={syncActiveImage}
          onPointerDown={handleImageDragStart}
          onPointerMove={handleImageDragMove}
          onPointerUp={finishImageDrag}
          onPointerCancel={finishImageDrag}
          className="absolute inset-0 flex snap-x snap-mandatory select-none overflow-x-auto overscroll-x-contain [touch-action:pan-x_pan-y] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {images.length
            ? images.map((image, index) => (
                <div
                  key={`${image.url}-${index}`}
                  data-card-image={index}
                  className="relative min-w-full snap-center snap-always"
                >
                  <Image
                    src={image.url}
                    alt={image.alt ?? product.name}
                    fill
                    sizes="(min-width: 1536px) 16vw, (min-width: 1280px) 20vw, (min-width: 640px) 33vw, 48vw"
                    preload={index === 0 ? preload : undefined}
                    draggable={false}
                    placeholder="blur"
                    blurDataURL={image.blurDataUrl ?? FALLBACK_BLUR}
                    onError={() => markImageFailed(image.url)}
                    className="object-contain p-2.5 transition duration-700 ease-[cubic-bezier(0.22,1,0.36,1)]"
                  />
                </div>
              ))
            : (
              <div className="grid min-w-full place-items-center bg-white text-ink-300">
                <PackageSearch className="size-12" aria-hidden />
                <span className="sr-only">Slika proizvoda nije dostupna</span>
              </div>
            )}
        </div>
        {topLeftBadges.length ? (
          <div className="pointer-events-none absolute top-0 left-0 flex max-w-[78%] flex-col items-start gap-1">
            {topLeftBadges.slice(0, 2).map((b) => (
              <ProductBadge key={b.key} badge={b} />
            ))}
          </div>
        ) : null}
        {bottomLeftBadges.length ? (
          <div className="pointer-events-none absolute bottom-1 left-0 flex max-w-[78%] flex-col items-start gap-1">
            {bottomLeftBadges.slice(0, 1).map((b) => (
              <ProductBadge key={b.key} badge={b} />
            ))}
          </div>
        ) : null}
        </Link>

        {images.length > 1 ? (
          <>
            <button
              type="button"
              aria-label="Prethodna fotografija"
              disabled={activeImage === 0}
              onClick={() => showImage(activeImage - 1)}
              className="focus-visible:ring-walnut/40 absolute top-1/2 left-2 z-20 hidden size-8 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-ink-900 shadow-soft-1 ring-1 ring-border/60 transition hover:bg-white focus-visible:ring-2 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-0 md:inline-flex"
            >
              <ChevronLeft className="size-4" aria-hidden />
            </button>
            <button
              type="button"
              aria-label="Sledeća fotografija"
              disabled={activeImage === images.length - 1}
              onClick={() => showImage(activeImage + 1)}
              className="focus-visible:ring-walnut/40 absolute top-1/2 right-2 z-20 hidden size-8 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-ink-900 shadow-soft-1 ring-1 ring-border/60 transition hover:bg-white focus-visible:ring-2 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-0 md:inline-flex"
            >
              <ChevronRight className="size-4" aria-hidden />
            </button>
            <div className="absolute inset-x-0 bottom-1 z-20 flex flex-wrap justify-center gap-0.5 px-2">
              {images.map((_, index) => (
                <button
                  type="button"
                  key={index}
                  data-card-image-dot
                  aria-label={`Prikaži fotografiju ${index + 1} od ${images.length}`}
                  aria-current={index === activeImage ? "true" : undefined}
                  onClick={() => showImage(index)}
                  className={cn(
                    "h-1.5 rounded-full transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-walnut",
                    index === activeImage
                      ? "w-4 bg-ink-900"
                      : "w-1.5 bg-white/85 ring-1 ring-border/70",
                  )}
                />
              ))}
            </div>
          </>
        ) : null}
      </div>

      {/* Wishlist heart */}
      <button
        type="button"
        aria-pressed={wished}
        aria-label={wished ? "Ukloni iz liste želja" : "Dodaj u listu želja"}
        onClick={() => toggleWish(product)}
        className="bg-surface/85 ring-border/60 hover:text-action focus-visible:ring-walnut/40 absolute top-3 right-3 inline-flex size-9 items-center justify-center rounded-full text-ink-700 ring-1 backdrop-blur transition focus-visible:ring-2 focus-visible:outline-none"
      >
        <Heart
          className={cn("size-4 transition", wished && "fill-action text-action")}
          aria-hidden
        />
      </button>

      {/* Body */}
      <div className="flex flex-1 flex-col gap-1.5 px-2.5 pt-2 pb-2 md:px-3 md:pt-2.5 md:pb-3">
        <h3 className="truncate text-xs leading-snug font-semibold text-ink-900 md:text-[13px]">
          <Link
            href={`/p/${product.slug}`}
            className="hover:text-walnut transition focus-visible:underline focus-visible:outline-none"
          >
            {product.name}
          </Link>
        </h3>
        <Link
          href={`/p/${product.slug}`}
          className="truncate text-[10px] leading-tight text-ink-500 transition hover:text-walnut focus-visible:underline focus-visible:outline-none md:text-[11px]"
        >
          {shortDescription}
        </Link>
        <ProductColorOptions product={product} className="h-4 pt-0" />

        <div className="mt-auto pt-0">
          <div className="flex flex-col items-stretch gap-1.5">
            <Link
              href={`/p/${product.slug}`}
              aria-label={`${product.name} — cena i detalji`}
              className="min-w-0 rounded-sm transition focus-visible:ring-2 focus-visible:ring-walnut/40 focus-visible:outline-none"
            >
              {hasReducedPrice ? (
                <div className="flex min-w-0 items-end justify-between gap-1.5">
                  <span className="min-w-0 truncate text-[10px] text-ink-500 line-through md:text-[11px]">
                    {formatRsd(price.full)}
                  </span>
                  <span className="text-action shrink-0 text-sm leading-none font-bold md:text-[15px]">
                    {formatRsd(price.effective)}
                  </span>
                </div>
              ) : (
                <span className="block truncate text-sm leading-none font-bold text-ink-900 md:text-[15px]">
                  {formatRsd(price.full)}
                </span>
              )}
            </Link>
            {availability.canAddToCart ? (
              <CartQuantityControl
                sku={product.sku}
                quantity={visibleLineQty}
                onAdd={handleAdd}
                tone="dark"
                addTone="dark"
                fullWidth
                className="w-full"
              />
            ) : (
              <button
                type="button"
                disabled
                className="inline-flex h-9 w-full cursor-not-allowed items-center justify-center rounded-full bg-muted-bg px-3 text-xs font-medium text-ink-500 ring-1 ring-border/60"
              >
                {availability.addLabel}
              </button>
            )}
          </div>
          <p className="mt-1 min-h-3.5 truncate text-[10px] leading-none text-ink-500 md:text-[11px]">
            {availability.canAddToCart ? promoLine : availability.message}
          </p>
        </div>
      </div>

    </motion.article>
  );
}

function ProductBadge({ badge }: { badge: Badge }) {
  if (badge.key === "new") {
    return (
      <ProductStickerBadge
        sticker={{ url: "/brand/promo-stickers/novo.svg", alt: "Novo", width: 600, height: 600 }}
        label={badge.label}
        className="h-[25px] w-[25px] md:h-7 md:w-7"
      />
    );
  }

  if (badge.key === "limited" || badge.key === "dtz") {
    return (
      <ProductStickerBadge
        sticker={{ url: "/brand/promo-stickers/dtz2.svg", alt: "Dok traju zalihe", width: 1536, height: 1024 }}
        label={badge.label}
        className="h-[22px] w-[34px] md:h-[25px] md:w-[39px]"
      />
    );
  }

  if (badge.key === "hero") {
    return (
      <ProductStickerBadge
        sticker={herojiMesecaIcon}
        label={badge.label}
        className="h-[25px] w-7 md:h-7 md:w-[34px]"
      />
    );
  }

  if (badge.key === "permanent") {
    return (
      <ProductStickerBadge
        sticker={protectedPricesIcon}
        label={badge.label}
        className="h-[25px] w-[31px] md:h-7 md:w-[34px]"
      />
    );
  }

  return (
    <span
      className={cn(
        "grid size-[25px] place-items-center rounded-full text-[8px] leading-none font-black text-white shadow-soft-1 md:size-7 md:text-[9px]",
        badge.key === "discount" ? "bg-action" : toneClasses[badge.tone],
      )}
    >
      {badge.label}
    </span>
  );
}

function ProductStickerBadge({
  sticker,
  label,
  className,
}: {
  sticker: { url: string; alt?: string; width?: number; height?: number };
  label?: string;
  className?: string;
}) {
  return (
    <span
      aria-label={label ?? sticker.alt}
      className={cn("flex items-center justify-center", className ?? "h-9 w-10 md:h-10 md:w-12")}
    >
      <Image
        src={sticker.url}
        alt={label ?? sticker.alt ?? ""}
        width={sticker.width ?? 80}
        height={sticker.height ?? 80}
        unoptimized
        className="h-full w-full object-contain"
      />
    </span>
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
        "bg-white ring-border/60 relative flex animate-pulse flex-col overflow-hidden rounded-lg shadow-soft-1 ring-1",
        className,
      )}
    >
      <div className="aspect-square bg-muted-bg" />
      <div className="flex flex-1 flex-col gap-1.5 px-3 pt-2.5 pb-3">
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
