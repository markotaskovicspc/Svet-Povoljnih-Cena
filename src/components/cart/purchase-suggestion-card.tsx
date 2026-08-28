"use client";

import Image from "next/image";
import Link from "next/link";
import { PackageSearch } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import type { Product } from "@/types";
import { cn } from "@/lib/utils";
import { formatRsd } from "@/lib/format";
import { getMediaVariantUrl, isRenderableImageUrl } from "@/lib/media";
import { getProductAvailability } from "@/lib/product-availability";
import { formatProductCardDimensions } from "@/lib/product-dimensions";
import {
  deriveBadges,
  resolveProductPriceQuote,
  type Badge,
  type BadgeTone,
} from "@/lib/pricing";
import { useLoyaltyEligibility } from "@/components/pricing/pricing-eligibility";
import { ProductColorOptions } from "@/components/product/color-options";
import { useCart } from "@/lib/hooks/use-cart";
import { commitAddToCart } from "@/components/cart/add-to-cart-action";
import { CartQuantityControl } from "@/components/cart/cart-quantity-control";

const FALLBACK_BLUR =
  "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA4IDYiPjxyZWN0IHdpZHRoPSI4IiBoZWlnaHQ9IjYiIGZpbGw9IiNmZmZmZmYiLz48L3N2Zz4=";

const badgeToneClasses: Record<BadgeTone, string> = {
  action: "bg-action text-white",
  gold: "bg-sand text-ink-900",
  olive: "bg-olive text-white",
  amber: "bg-warning text-ink-900",
  red: "bg-action/10 text-action ring-1 ring-action/30",
  ink: "bg-ink-900 text-canvas",
  protected: "bg-brand-blue text-white",
};

export function PurchaseSuggestionCard({
  product: familyProduct,
}: {
  product: Product;
}) {
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
  const cartHydrated = useCart((state) => state.hydrated);
  const lineQty = useCart(
    (state) => state.lines.find((line) => line.sku === product.sku)?.qty ?? 0,
  );
  const visibleLineQty = cartHydrated ? lineQty : 0;
  const [failedImageUrl, setFailedImageUrl] = useState("");
  const imageUrl = getMediaVariantUrl(product.media.images[0], "card");
  const showImage =
    isRenderableImageUrl(imageUrl) && failedImageUrl !== imageUrl;
  const quote = resolveProductPriceQuote(pricingProduct);
  const hasReducedPrice = Boolean(quote.actionOffer || quote.loyaltyOffer);
  const dimensions = formatProductCardDimensions(product.dimensionsCm);
  const availability = getProductAvailability(product);
  const deliveryLine = availability.canAddToCart
    ? product.supplierIntegrationKey?.toUpperCase() === "RABALUX"
      ? availability.message
      : `Isporuka ${product.deliveryDays.min}–${product.deliveryDays.max} radnih dana`
    : availability.message;
  const badges = deriveBadges(pricingProduct);
  const badge =
    badges.find((candidate) => candidate.key === "discount") ?? badges[0];

  function handleAdd() {
    if (!availability.canAddToCart) return;
    void commitAddToCart(pricingProduct);
  }

  return (
    <article
      data-testid="purchase-suggestion-card"
      data-sku={product.sku}
      className="ring-border/60 flex h-full min-w-0 flex-col overflow-hidden rounded-xl bg-white text-ink-900 shadow-soft-1 ring-1"
    >
      <Link
        href={`/p/${product.slug}`}
        aria-label={`${product.name} — pregled proizvoda`}
        className="focus-visible:ring-walnut/40 relative block aspect-[4/3] overflow-hidden bg-white focus-visible:ring-2 focus-visible:outline-none"
      >
        {showImage ? (
          <Image
            src={imageUrl}
            alt={product.media.images[0]?.alt ?? product.name}
            fill
            sizes="(min-width: 768px) 240px, (min-width: 360px) 44vw, 280px"
            placeholder="blur"
            blurDataURL={product.media.images[0]?.blurDataUrl ?? FALLBACK_BLUR}
            onError={() => setFailedImageUrl(imageUrl)}
            className="object-contain p-3"
          />
        ) : (
          <span className="grid size-full place-items-center text-ink-300">
            <PackageSearch className="size-11" aria-hidden />
            <span className="sr-only">Slika proizvoda nije dostupna</span>
          </span>
        )}
        {badge ? <SuggestionBadge badge={badge} /> : null}
      </Link>

      <div className="flex min-w-0 flex-1 flex-col p-2.5 sm:p-3">
        <h3 className="line-clamp-2 min-h-10 text-sm leading-5 font-semibold text-ink-900">
          <Link
            href={`/p/${product.slug}`}
            className="transition hover:text-walnut focus-visible:underline focus-visible:outline-none"
          >
            {product.name}
          </Link>
        </h3>
        <p className="mt-0.5 min-h-4 truncate text-[11px] leading-4 text-ink-500">
          {dimensions || "Dimenzije nisu navedene"}
        </p>

        <ProductColorOptions
          product={product}
          selectedSku={selectedSku}
          onSelectSku={setSelectedSku}
          className="mt-2 min-h-10"
        />

        <div className="mt-auto min-w-0 pt-3">
          <Link
            href={`/p/${product.slug}`}
            aria-label={`${product.name} — cena i detalji`}
            className="focus-visible:ring-walnut/40 block min-w-0 rounded-sm focus-visible:ring-2 focus-visible:outline-none"
          >
            {hasReducedPrice ? (
              <div className="space-y-1.5">
                <span className="block whitespace-nowrap text-[11px] text-ink-500 line-through">
                  {formatRsd(quote.full)}
                </span>
                {quote.actionOffer ? (
                  <SuggestionPrice
                    label="Akcija"
                    value={quote.actionOffer.effective}
                  />
                ) : null}
                {quote.loyaltyOffer ? (
                  <SuggestionPrice
                    label="Loyalty"
                    value={quote.loyaltyOffer.effective}
                  />
                ) : null}
              </div>
            ) : (
              <span
                data-testid="purchase-suggestion-price"
                className="block whitespace-nowrap text-base leading-5 font-bold tabular-nums text-ink-900"
              >
                {formatRsd(quote.payable.full)}
              </span>
            )}
          </Link>

          <div
            data-testid="purchase-suggestion-cart-control"
            className="mt-2 min-w-0"
          >
            {availability.canAddToCart ? (
              <CartQuantityControl
                sku={product.sku}
                quantity={visibleLineQty}
                onAdd={handleAdd}
                size="md"
                tone="dark"
                addTone="dark"
                fullWidth
                className="h-11 min-w-0 px-2 text-xs"
              />
            ) : (
              <button
                type="button"
                disabled
                className="ring-border/60 inline-flex h-11 w-full cursor-not-allowed items-center justify-center rounded-full bg-muted-bg px-2 text-xs font-medium text-ink-500 ring-1"
              >
                {availability.addLabel}
              </button>
            )}
          </div>
          <p className="mt-1.5 line-clamp-2 min-h-8 break-words text-[10px] leading-4 text-ink-500">
            {deliveryLine}
          </p>
        </div>
      </div>
    </article>
  );
}

function SuggestionBadge({ badge }: { badge: Badge }) {
  return (
    <span
      className={cn(
        "absolute top-2 left-2 max-w-[calc(100%-1rem)] truncate rounded-full px-2 py-1 text-[10px] leading-none font-semibold shadow-soft-1",
        badgeToneClasses[badge.tone],
      )}
    >
      {badge.label}
    </span>
  );
}

function SuggestionPrice({ label, value }: { label: string; value: number }) {
  return (
    <span className="block min-w-0">
      <span className="block text-[9px] leading-3 font-semibold tracking-wide text-ink-500 uppercase">
        {label}
      </span>
      <span
        data-testid="purchase-suggestion-price"
        className="block whitespace-nowrap text-base leading-5 font-bold tabular-nums text-action"
      >
        {formatRsd(value)}
      </span>
    </span>
  );
}
