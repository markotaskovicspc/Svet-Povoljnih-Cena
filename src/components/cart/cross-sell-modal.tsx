"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useCartUi } from "@/lib/hooks/use-cart-ui";
import { useCart } from "@/lib/hooks/use-cart";
import type { Product } from "@/types";
import { getCrossSellContinueLabel } from "@/lib/cross-sell";
import { PurchaseSuggestion } from "./purchase-suggestion";

/**
 * "Predlog kupovine" modal. Mounted globally; opens immediately after an
 * eligible add-to-cart action and before explicit cart navigation.
 */
export function CrossSellModal() {
  const destination = useCartUi((s) => s.suggestionDestination);
  const crossSellSku = useCartUi((s) => s.crossSellSku);
  const lines = useCart((state) => state.lines);
  const skus = useMemo(
    () =>
      crossSellSku
        ? [crossSellSku]
        : lines.map((line) => line.sku),
    [crossSellSku, lines],
  );
  const requested = Boolean(destination || crossSellSku);

  if (!requested) return null;

  return (
    <RequestedCrossSellModal
      destination={destination}
      skus={skus}
      requestKey={skus.join("|")}
    />
  );
}

function RequestedCrossSellModal({
  destination,
  skus,
  requestKey,
}: {
  destination: string | null;
  skus: string[];
  requestKey: string;
}) {
  const router = useRouter();
  const close = useCartUi((s) => s.closeCrossSell);
  const [result, setResult] = useState<{
    key: string;
    products: Product[];
  } | null>(null);
  const products = result?.key === requestKey ? result.products : [];
  const open = result?.key === requestKey && products.length > 0;
  const continueLabel = getCrossSellContinueLabel(destination);

  useEffect(() => {
    const target = destination ?? "/korpa";
    if (!skus.length) {
      close();
      if (destination) router.push(target);
      return;
    }

    const controller = new AbortController();
    fetch("/api/cart/recommendations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ skus, limit: 6 }),
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error("Recommendations unavailable");
        return response.json() as Promise<{ products?: Product[] }>;
      })
      .then((data) => {
        const next = Array.isArray(data.products) ? data.products : [];
        if (!next.length) {
          close();
          if (destination) router.push(target);
          return;
        }
        setResult({ key: requestKey, products: next });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        close();
        if (destination) router.push(target);
      });
    return () => controller.abort();
  }, [close, destination, requestKey, router, skus]);

  useEffect(() => {
    if (open) toast.dismiss();
  }, [open]);

  function continueToDestination() {
    const target = destination ?? "/korpa";
    close();
    router.push(target);
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent
        data-testid="cross-sell-dialog"
        closeLabel="Zatvori predlog kupovine"
        closeButtonClassName="top-2.5 right-2.5 size-11 sm:top-3 sm:right-3 sm:size-9"
        className="top-2 bottom-0 z-[120] grid h-auto max-h-none w-[calc(100%-0.5rem)] max-w-none translate-y-0 grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden rounded-t-2xl rounded-b-none bg-surface p-0 sm:top-1/2 sm:bottom-auto sm:h-[min(48rem,calc(100dvh-2rem))] sm:max-h-none sm:max-w-4xl sm:-translate-y-1/2 sm:rounded-xl"
      >
        <DialogHeader
          data-testid="cross-sell-header"
          className="border-b border-border/60 bg-surface px-4 pt-4 pr-14 pb-3 sm:px-5 sm:pt-5 sm:pr-16 sm:pb-4"
        >
          <DialogTitle className="font-display text-lg leading-tight text-ink-900 sm:text-xl">
            Predlog kupovine
          </DialogTitle>
          <DialogDescription className="text-xs leading-relaxed text-ink-500 sm:text-sm">
            Pre nastavka možete brzo pogledati artikle koje je admin povezao sa proizvodima iz korpe.
          </DialogDescription>
        </DialogHeader>
        <div
          data-testid="cross-sell-scroll-area"
          className="min-h-0 overflow-y-auto overscroll-contain px-3 py-3 sm:px-4 sm:py-4"
        >
          <PurchaseSuggestion products={products} />
        </div>
        <DialogFooter
          data-testid="cross-sell-footer"
          className="mx-0 mb-0 grid grid-cols-2 gap-2 rounded-none border-t border-border/60 bg-surface px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:flex sm:flex-row sm:justify-end sm:px-5 sm:py-4"
        >
          <Button
            type="button"
            variant="outline"
            onClick={close}
            className="h-11 w-full px-2 text-xs sm:w-auto sm:px-4 sm:text-sm"
          >
            Ostani u kupovini
          </Button>
          <Button
            type="button"
            onClick={continueToDestination}
            className="h-11 w-full px-2 text-xs sm:w-auto sm:px-4 sm:text-sm"
          >
            {continueLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
