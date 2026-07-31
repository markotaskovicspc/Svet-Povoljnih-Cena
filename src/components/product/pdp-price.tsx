"use client";

import type { Product } from "@/types";
import { useLoyaltyEligibility } from "@/components/pricing/pricing-eligibility";
import { effectiveUnitPrice } from "@/lib/pricing";
import { formatDate, formatRsd } from "@/lib/format";

/**
 * Personalized price island for an otherwise public, CDN-cacheable PDP.
 * The server HTML always contains the public price; authenticated customers
 * receive their loyalty price after the session endpoint resolves.
 */
export function PdpPrice({ product }: { product: Product }) {
  const loyaltyEligible = useLoyaltyEligibility();
  const pricingProduct =
    product.loyaltyEligible === loyaltyEligible
      ? product
      : { ...product, loyaltyEligible };
  const price = effectiveUnitPrice(pricingProduct);
  const hasReducedPrice = price.effective < price.full;

  return (
    <>
      <p className="mb-0.5 text-xs font-semibold text-ink-500 md:mb-1">
        {price.kind === "loyalty"
          ? "Loyalty cena"
          : price.kind === "sale" || price.kind === "linear"
            ? "Akcijska cena"
            : "Cena"}
      </p>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        {hasReducedPrice ? (
          <>
            <span className="text-action text-[30px] leading-none font-black md:text-[34px]">
              {formatRsd(price.effective)}
            </span>
            <span className="text-sm text-ink-500 line-through">
              {formatRsd(price.full)}
            </span>
          </>
        ) : (
          <span className="text-[28px] leading-none font-black text-ink-900 md:text-[30px]">
            {formatRsd(price.full)}
          </span>
        )}
      </div>
      {price.kind === "sale" && product.action?.isPermanent ? (
        <p className="mt-1 text-xs text-ink-500">
          Trajno niska cena od 01.05.2026.
        </p>
      ) : price.kind === "sale" && product.action?.startsAt && product.action.endsAt ? (
        <p className="mt-1 text-xs text-ink-500">
          Akcijska cena važi od {formatDate(product.action.startsAt)} do{" "}
          {formatDate(product.action.endsAt)}
        </p>
      ) : price.kind === "loyalty" ? (
        <p className="mt-1 text-xs text-ink-500">Cena za kupce sa nalogom.</p>
      ) : price.kind === "linear" ? (
        <p className="mt-1 text-xs text-ink-500">
          Dodatni akcijski popust na izabrani asortiman.
        </p>
      ) : null}
    </>
  );
}
