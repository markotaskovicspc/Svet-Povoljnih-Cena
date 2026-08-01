"use client";

import Link from "next/link";
import type { Product } from "@/types";
import { useLoyaltyEligibility } from "@/components/pricing/pricing-eligibility";
import { resolveProductPriceQuote } from "@/lib/pricing";
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
  const quote = resolveProductPriceQuote(pricingProduct);
  const { actionOffer, loyaltyOffer, payable } = quote;

  return (
    <>
      <p className="mb-0.5 text-xs font-semibold text-ink-500 md:mb-1">
        Cena
      </p>
      <div className="space-y-1.5">
        {!actionOffer && !loyaltyOffer ? (
          <span className="text-[28px] leading-none font-black text-ink-900 md:text-[30px]">
            {formatRsd(quote.full)}
          </span>
        ) : (
          <p className="text-sm text-ink-500">
            Redovna cena: <span className="line-through">{formatRsd(quote.full)}</span>
          </p>
        )}
        {actionOffer ? (
          <PriceOfferRow
            label="Akcijska cena"
            value={actionOffer.effective}
            selected={payable.kind !== "loyalty"}
          />
        ) : null}
        {loyaltyOffer ? (
          <PriceOfferRow
            label="Loyalty cena"
            value={loyaltyOffer.effective}
            selected={payable.kind === "loyalty"}
          />
        ) : null}
      </div>
      {loyaltyOffer && !loyaltyEligible ? (
        <p className="mt-1 text-xs text-ink-500">
          Loyalty cena važi uz prijavljen nalog. {" "}
          <Link
            href={`/nalog/prijava?callbackUrl=${encodeURIComponent(`/p/${product.slug}`)}`}
            className="font-semibold text-walnut hover:underline"
          >
            Prijavite se
          </Link>
        </p>
      ) : payable.kind === "loyalty" ? (
        <p className="mt-1 text-xs text-ink-500">
          Loyalty cena je primenjena na prijavljeni nalog.
        </p>
      ) : payable.kind === "sale" && product.action?.isPermanent ? (
        <p className="mt-1 text-xs text-ink-500">
          Trajno niska cena od 01.05.2026.
        </p>
      ) : payable.kind === "sale" && product.action?.startsAt && product.action.endsAt ? (
        <p className="mt-1 text-xs text-ink-500">
          Akcijska cena važi od {formatDate(product.action.startsAt)} do{" "}
          {formatDate(product.action.endsAt)}
        </p>
      ) : payable.kind === "linear" ? (
        <p className="mt-1 text-xs text-ink-500">
          Dodatni akcijski popust na izabrani asortiman.
        </p>
      ) : null}
    </>
  );
}

function PriceOfferRow({
  label,
  value,
  selected,
}: {
  label: string;
  value: number;
  selected: boolean;
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3">
      <span className="min-w-24 text-xs font-semibold text-ink-600">{label}</span>
      <span
        className={
          selected
            ? "text-action text-[30px] leading-none font-black md:text-[34px]"
            : "text-xl leading-none font-bold text-ink-900"
        }
      >
        {formatRsd(value)}
      </span>
    </div>
  );
}
