"use client";

/**
 * Product card — Phase 1C polish.
 * Adds: image badges, qty-stepper morph from "Dodaj u korpu" button when item is in cart, blur placeholder,
 * skeleton loading variant, reduced-motion friendly micro-interactions.
 */
import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  ChevronLeft,
  ChevronRight,
  Heart,
  PackageSearch,
} from "lucide-react";
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
  resolveProductPriceQuote,
  type Badge,
  type BadgeTone,
} from "@/lib/pricing";
import {
  herojiMesecaIcon,
  protectedPricesIcon,
  type CampaignStickerKey,
} from "@/data/campaign-icons";
import { useLoyaltyEligibility } from "@/components/pricing/pricing-eligibility";
import { formatProductCardDimensions } from "@/lib/product-dimensions";

interface ProductCardProps {
  product: Product;
  className?: string;
  /** Preload the cover image only when the card image is the route LCP. */
  preload?: boolean;
  /** Contextual promo sticker inherited from the current rail/listing. */
  campaignSticker?: CampaignStickerKey;
  /** Keeps every card detail while reducing homepage card height on desktop. */
  compactOnDesktop?: boolean;
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
  product: familyProduct,
  className,
  preload,
  compactOnDesktop,
}: ProductCardProps) {
  const reduced = useReducedMotion();
  const loyaltyEligible = useLoyaltyEligibility();
  const familyKey = familyProduct.variantFamily?.id ?? `sku:${familyProduct.sku}`;
  const defaultSelectedSku =
    familyProduct.variantFamily?.selectedSku ?? familyProduct.sku;
  const [selection, setSelection] = useState({
    familyKey,
    sku: defaultSelectedSku,
  });
  const selectedSku =
    selection.familyKey === familyKey &&
    (familyProduct.variantFamily?.options.some(
      (option) => option.sku === selection.sku,
    ) ?? selection.sku === familyProduct.sku)
      ? selection.sku
      : defaultSelectedSku;
  const setSelectedSku = useCallback(
    (sku: string) => setSelection({ familyKey, sku }),
    [familyKey],
  );
  const product = useMemo(() => {
    const option = familyProduct.variantFamily?.options.find(
      (candidate) => candidate.sku === selectedSku,
    );
    if (!option) return familyProduct;
    return {
      ...familyProduct,
      id: option.productId,
      sku: option.sku,
      slug: option.slug,
      name: option.name,
      colorPrimary: option.colorPrimary,
      colorSecondary: option.colorSecondary,
      media: option.media,
      pictograms: option.pictograms ?? familyProduct.pictograms,
      fullPrice: option.fullPrice,
      referencePrice: option.referencePrice,
      salePrice: option.salePrice,
      discountPct: option.discountPct,
      loyaltyPrice: option.loyaltyPrice,
      loyaltyDiscountPct: option.loyaltyDiscountPct,
      stock: option.stock,
      incomingStock: option.incomingStock,
      supplierNextArrivalAt: option.supplierNextArrivalAt,
      availabilitySource: option.availabilitySource,
      deliveryDays: option.deliveryDays,
      isHero: option.isHero ?? false,
      isNew: option.isNew ?? false,
      isLimited: option.isLimited ?? false,
      isDtz: option.isDtz ?? false,
      action: option.action,
      actionPrices: option.actionPrices,
      variantFamily: familyProduct.variantFamily
        ? { ...familyProduct.variantFamily, selectedSku: option.sku }
        : undefined,
    };
  }, [familyProduct, selectedSku]);
  const pricingProduct =
    product.loyaltyEligible === loyaltyEligible
      ? product
      : { ...product, loyaltyEligible };
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
  const [imageSelection, setImageSelection] = useState({ sku: "", index: 0 });
  const activeImage =
    imageSelection.sku === product.sku ? imageSelection.index : 0;
  const setActiveImage = useCallback(
    (index: number) => setImageSelection({ sku: product.sku, index }),
    [product.sku],
  );
  useEffect(() => {
    imageTrackRef.current?.scrollTo({ left: 0, behavior: "auto" });
  }, [product.sku]);
  const imageBadges = deriveImageBadges(pricingProduct);
  const topLeftBadges = imageBadges.topLeft;
  const bottomLeftBadges = imageBadges.bottomLeft;
  const quote = resolveProductPriceQuote(pricingProduct);
  const price = quote.payable;
  const hasReducedPrice = Boolean(quote.actionOffer || quote.loyaltyOffer);
  const dimensions = formatProductCardDimensions(product.dimensionsCm);
  const promoLine = product.action?.isPermanent
    ? "Trajno niska cena"
    : price.kind === "sale" && product.action?.endsAt
      ? `Akcija do ${formatDate(product.action.endsAt)}`
      : price.kind === "linear"
        ? "Dodatni akcijski popust"
        : quote.loyaltyOffer
          ? loyaltyEligible
            ? "Loyalty cena je aktivna"
            : "Loyalty cena uz prijavljen nalog"
          : "";
  const availability = getProductAvailability(product);
  const deliveryLine = `Isporuka ${product.deliveryDays.min}–${product.deliveryDays.max} radnih dana`;
  const footerLine = availability.canAddToCart
    ? [promoLine, deliveryLine].filter(Boolean).join(" · ")
    : availability.message;

  const hoverProps = reduced ? {} : { whileHover: { y: -6, rotate: -1 } };

  const syncActiveImage = useCallback(() => {
    if (!images.length) return;
    const track = imageTrackRef.current;
    if (!track) return;
    const index = Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
    setActiveImage(Math.max(0, Math.min(index, images.length - 1)));
  }, [images.length, setActiveImage]);

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
    [images.length, reduced, setActiveImage],
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
    commitAddToCart(pricingProduct);
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
                    sizes="(min-width: 1280px) 220px, (min-width: 768px) 210px, (min-width: 640px) 38vw, (min-width: 394px) 46vw, 164px"
                    preload={index === 0 ? preload : undefined}
                    draggable={false}
                    placeholder="blur"
                    blurDataURL={image.blurDataUrl ?? FALLBACK_BLUR}
                    onError={() => markImageFailed(image.url)}
                    className="object-contain p-3 transition duration-700 ease-[cubic-bezier(0.22,1,0.36,1)]"
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
        {topLeftBadges.length || product.pictograms.length ? (
          <div className="pointer-events-none absolute top-0 left-0 flex max-w-[78%] flex-col items-start gap-1">
            {topLeftBadges.slice(0, 2).map((b) => (
              <ProductBadge key={b.key} badge={b} />
            ))}
            <ProductCardPictograms pictograms={product.pictograms} />
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
        onClick={() => toggleWish(pricingProduct)}
        className={cn(
          "bg-surface/85 ring-border/60 hover:text-action focus-visible:ring-walnut/40 absolute top-3 right-3 inline-flex size-9 items-center justify-center rounded-full text-ink-700 ring-1 backdrop-blur transition focus-visible:ring-2 focus-visible:outline-none",
          compactOnDesktop && "md:top-2.5 md:right-2.5 md:size-[31px]",
        )}
      >
        <Heart
          className={cn(
            "size-4 transition",
            compactOnDesktop && "md:size-3.5",
            wished && "fill-action text-action",
          )}
          aria-hidden
        />
      </button>

      {/* Body */}
      <div
        className={cn(
          "flex flex-1 flex-col gap-1.5 px-2.5 pt-2 pb-2 md:px-3 md:pt-2.5 md:pb-3",
          compactOnDesktop && "md:gap-[5px] md:px-2.5 md:pt-2 md:pb-2.5",
        )}
      >
        <h3
          className={cn(
            "truncate text-xs leading-snug font-semibold text-ink-900 md:text-[13px]",
            compactOnDesktop && "md:text-[11px]",
          )}
        >
          <Link
            href={`/p/${product.slug}`}
            className="hover:text-walnut transition focus-visible:underline focus-visible:outline-none"
          >
            {product.name}
          </Link>
        </h3>
        {dimensions ? (
          <Link
            href={`/p/${product.slug}`}
            className={cn(
              "truncate text-[10px] leading-tight text-ink-500 transition hover:text-walnut focus-visible:underline focus-visible:outline-none md:text-[11px]",
              compactOnDesktop && "md:text-[9px]",
            )}
          >
            {dimensions}
          </Link>
        ) : null}
        <ProductColorOptions
          product={product}
          selectedSku={selectedSku}
          onSelectSku={setSelectedSku}
          className={cn(
            "min-h-10 pt-0",
            compactOnDesktop && "md:min-h-10 md:gap-1",
          )}
        />

        <div className="mt-auto pt-0">
          <div className="flex flex-col items-stretch gap-1.5">
            <Link
              href={`/p/${product.slug}`}
              aria-label={`${product.name} — cena i detalji`}
              className="min-w-0 rounded-sm transition focus-visible:ring-2 focus-visible:ring-walnut/40 focus-visible:outline-none"
            >
              {hasReducedPrice ? (
                <div className="space-y-0.5">
                  <span
                    className={cn(
                      "block truncate text-[10px] text-ink-500 md:text-[11px]",
                      compactOnDesktop && "md:text-[9px]",
                    )}
                  >
                    {formatRsd(quote.full)}
                  </span>
                  {quote.actionOffer ? (
                    <CompactPriceOffer
                      label="Akcija"
                      value={quote.actionOffer.effective}
                      selected={price.kind !== "loyalty"}
                      compactOnDesktop={compactOnDesktop}
                    />
                  ) : null}
                  {quote.loyaltyOffer ? (
                    <CompactPriceOffer
                      label="Loyalty"
                      value={quote.loyaltyOffer.effective}
                      selected={price.kind === "loyalty"}
                      compactOnDesktop={compactOnDesktop}
                    />
                  ) : null}
                </div>
              ) : (
                <span
                  className={cn(
                    "block truncate text-sm leading-none font-bold text-ink-900 md:text-[15px]",
                    compactOnDesktop && "md:text-[13px]",
                  )}
                >
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
                className={cn(
                  "w-full",
                  compactOnDesktop && "md:h-[31px] md:px-2.5 md:text-[10px]",
                )}
              />
            ) : (
              <button
                type="button"
                disabled
                className={cn(
                  "inline-flex h-9 w-full cursor-not-allowed items-center justify-center rounded-full bg-muted-bg px-3 text-xs font-medium text-ink-500 ring-1 ring-border/60",
                  compactOnDesktop && "md:h-[31px] md:px-2.5 md:text-[10px]",
                )}
              >
                {availability.addLabel}
              </button>
            )}
          </div>
          <p
            className={cn(
              "mt-1 min-h-6 break-words text-[9px] leading-tight text-ink-500 sm:text-[10px] md:text-[10px]",
              compactOnDesktop &&
                "md:mt-1 md:min-h-5 md:text-[9px] md:leading-tight",
            )}
          >
            {footerLine}
          </p>
        </div>
      </div>

    </motion.article>
  );
}

function CompactPriceOffer({
  label,
  value,
  selected,
  compactOnDesktop,
}: {
  label: string;
  value: number;
  selected: boolean;
  compactOnDesktop?: boolean;
}) {
  return (
    <span
      className={cn(
        "flex items-baseline justify-between gap-1.5 sm:gap-2",
        compactOnDesktop && "md:gap-1.5",
      )}
    >
      <span
        className={cn(
          "text-[9px] font-semibold uppercase tracking-wide text-ink-500",
          compactOnDesktop && "md:text-[8px]",
        )}
      >
        {label}
      </span>
      <span
        className={cn(
          "shrink-0 text-sm leading-none font-bold md:text-[15px]",
          compactOnDesktop && "md:text-[13px]",
          selected || label === "Loyalty" ? "text-action" : "text-ink-900",
        )}
      >
        {formatRsd(value)}
      </span>
    </span>
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

function ProductCardPictograms({
  pictograms,
}: {
  pictograms: Product["pictograms"];
}) {
  const visible = pictograms.slice(0, 6);
  if (!visible.length) return null;

  return (
    <ul
      data-product-card-pictograms
      aria-label="Karakteristike proizvoda"
      className="flex flex-col gap-1"
    >
      {visible.map((pictogram) => (
        <li
          key={pictogram.code}
          title={pictogram.label}
          className="relative size-[25px] overflow-hidden rounded-full bg-white/90 shadow-soft-1 ring-1 ring-white/80 md:size-7"
        >
          <Image
            src={pictogram.iconUrl}
            alt=""
            width={40}
            height={40}
            sizes="(min-width: 768px) 28px, 25px"
            className="size-full scale-[1.18] object-contain"
          />
          <span className="sr-only">{pictogram.label}</span>
        </li>
      ))}
    </ul>
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
