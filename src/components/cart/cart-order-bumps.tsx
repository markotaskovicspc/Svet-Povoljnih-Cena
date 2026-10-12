"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Loader2, PackagePlus, Plus } from "lucide-react";
import { toast } from "sonner";
import { useCart } from "@/lib/hooks/use-cart";
import type { CartOrderBumpOffer } from "@/lib/order-bump";
import { getMediaVariantUrl, isRenderableImageUrl } from "@/lib/media";
import { formatRsd } from "@/lib/format";
import { formatProductCardDimensions } from "@/lib/product-dimensions";
import { effectiveUnitPrice } from "@/lib/pricing";
import { getProductAvailability } from "@/lib/product-availability";
import { useLoyaltyEligibility } from "@/components/pricing/pricing-eligibility";
import { recordFirstPartyEvent } from "@/components/analytics/first-party-analytics";
import { commitAddToCart } from "./add-to-cart-action";

export function CartOrderBumps() {
  const lines = useCart(state => state.lines);
  const requestKey = [...new Set(lines.map(line => line.sku))].sort().join("|");
  const [result, setResult] = useState<{ key: string; offers: CartOrderBumpOffer[] } | null>(null);

  useEffect(() => {
    if (!requestKey) return;
    const controller = new AbortController();
    void fetch("/api/cart/recommendations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ skus: requestKey.split("|"), surface: "order_bump", limit: 2 }),
      signal: controller.signal,
    }).then(async response => {
      if (!response.ok) throw new Error("Recommendations unavailable");
      const data = await response.json() as { offers?: CartOrderBumpOffer[] };
      if (!controller.signal.aborted) setResult({ key: requestKey, offers: Array.isArray(data.offers) ? data.offers : [] });
    }).catch(() => {
      // A recommendation failure must never block the basket or checkout.
      if (!controller.signal.aborted) setResult({ key: requestKey, offers: [] });
    });
    return () => controller.abort();
  }, [requestKey]);

  const skus = new Set(lines.map(line => line.sku));
  const offers = result?.key === requestKey
    ? result.offers.filter(offer => skus.has(offer.sourceSku) && !skus.has(offer.product.sku) && getProductAvailability(offer.product).canAddToCart).slice(0, 2)
    : [];
  if (!offers.length) return null;

  return (
    <section aria-labelledby="cart-extra-offer-heading" data-testid="cart-order-bumps"
      className="rounded-2xl border-2 border-dashed border-action/40 bg-action/5 p-4 sm:p-5">
      <div className="mb-4 flex items-start gap-3">
        <span className="rounded-full bg-action/10 p-2 text-action"><PackagePlus className="size-5" aria-hidden /></span>
        <div>
          <h2 id="cart-extra-offer-heading" className="text-base font-bold text-action sm:text-lg">Upotpunite kupovinu</h2>
          <p className="mt-1 text-xs leading-5 text-ink-500 sm:text-sm">Ovi proizvodi nisu u vašoj korpi. Dodaju se samo ako ih izaberete.</p>
        </div>
      </div>
      <div className="grid gap-3">
        {offers.map(offer => <OrderBumpCard key={`${offer.id}:${offer.sourceSku}:${offer.product.sku}`} offer={offer} />)}
      </div>
    </section>
  );
}

function OrderBumpCard({ offer }: { offer: CartOrderBumpOffer }) {
  const loyaltyEligible = useLoyaltyEligibility();
  const product = { ...offer.product, loyaltyEligible };
  const price = effectiveUnitPrice(product);
  const imageUrl = getMediaVariantUrl(product.media.images[0], "card");
  const [imageFailed, setImageFailed] = useState(false);
  const [adding, setAdding] = useState(false);
  const addingRef = useRef(false);
  const ref = useRef<HTMLElement>(null);
  const exposureSent = useRef(false);
  const dimensions = formatProductCardDimensions(product.dimensionsCm);
  const variant = product.variantFamily?.options.find(option => option.sku === product.sku)?.label;

  useEffect(() => {
    let visible = false;
    const track = () => {
      if (!visible || exposureSent.current || document.visibilityState !== "visible") return;
      exposureSent.current = recordFirstPartyEvent({ type: "ORDER_BUMP", path: "/korpa", productId: offer.product.id,
        metadata: { surface: "cart_order_bump", event: "viewed", eventId: crypto.randomUUID(), offerId: offer.id, sourceSku: offer.sourceSku } });
    };
    const observer = new IntersectionObserver(entries => { visible = entries.some(entry => entry.isIntersecting && entry.intersectionRatio >= .5); track(); }, { threshold: [.5] });
    if (ref.current) observer.observe(ref.current);
    window.addEventListener("spc-cookie-consent", track);
    document.addEventListener("visibilitychange", track);
    return () => { observer.disconnect(); window.removeEventListener("spc-cookie-consent", track); document.removeEventListener("visibilitychange", track); };
  }, [offer.id, offer.product.id, offer.sourceSku]);

  async function addOffer() {
    if (addingRef.current) return;
    addingRef.current = true;
    setAdding(true);
    try {
      await commitAddToCart(product, 1, { silent: true, orderBump: { offerId: offer.id, sourceSku: offer.sourceSku, quantity: 1 } });
      const added = useCart.getState().lines.find(line => line.sku === product.sku);
      if (added?.orderBump?.offerId === offer.id) toast.success(`${product.name} je dodat u korpu.`);
    } finally {
      addingRef.current = false;
      setAdding(false);
    }
  }

  return (
    <article ref={ref} data-testid="cart-order-bump-offer" data-sku={product.sku}
      className="grid grid-cols-[88px_minmax(0,1fr)] gap-3 rounded-xl bg-white p-3 shadow-soft-1 sm:grid-cols-[112px_minmax(0,1fr)_auto] sm:items-center sm:gap-4">
      <Link href={`/p/${product.slug}`} aria-label={`${product.name} — pogledaj proizvod`}
        className="relative aspect-square self-start overflow-hidden rounded-lg bg-white ring-1 ring-border/50 focus-visible:outline-2 focus-visible:outline-action">
        {!imageFailed && isRenderableImageUrl(imageUrl)
          ? <Image src={imageUrl} alt={product.media.images[0]?.alt ?? product.name} fill sizes="112px" className="object-contain p-2" onError={() => setImageFailed(true)} />
          : <span className="grid size-full place-items-center text-ink-300"><PackagePlus className="size-8" aria-hidden /></span>}
      </Link>
      <div className="min-w-0">
        <span className="inline-flex rounded-full bg-action/10 px-2 py-1 text-[10px] font-semibold text-action">Dodatna ponuda · nije u korpi</span>
        <h3 className="mt-2 text-sm font-semibold leading-5 text-ink-900"><Link href={`/p/${product.slug}`} className="hover:underline">{product.name}</Link></h3>
        {(dimensions || variant) && <p className="mt-1 text-xs text-ink-500">{[dimensions, variant].filter(Boolean).join(" · ")}</p>}
        <p className="mt-1 text-xs leading-5 text-ink-500">Predlog uz: {offer.sourceName}</p>
      </div>
      <div className="col-span-2 flex items-center justify-between gap-3 border-t border-border/40 pt-3 sm:col-span-1 sm:flex-col sm:items-end sm:border-0 sm:pt-0">
        <div>
          {price.effective < price.full && <span className="block text-[11px] text-ink-500 line-through">{formatRsd(price.full)}</span>}
          <span data-testid="order-bump-price" className={`whitespace-nowrap text-lg font-bold tabular-nums ${price.effective < price.full ? "text-action" : "text-ink-900"}`}>{formatRsd(price.effective)}</span>
        </div>
        <button type="button" onClick={() => void addOffer()} disabled={adding}
          aria-label={`Dodaj ${product.name} u korpu`}
          className="inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-full bg-action px-4 py-2 text-xs font-semibold text-white transition hover:bg-action/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action disabled:cursor-wait disabled:opacity-60">
          {adding ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Plus className="size-4" aria-hidden />}
          {adding ? "Proveravam…" : "Dodaj u korpu"}
        </button>
        <span className="sr-only">Dostava će biti preračunata nakon dodavanja.</span>
      </div>
    </article>
  );
}
