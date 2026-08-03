"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
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
import { PurchaseSuggestion } from "./purchase-suggestion";

/**
 * "Predlog kupovine" modal. Mounted globally; opens from "Pregled korpe"
 * and "Plati" actions, with products loaded from admin recommendation rules.
 */
export function CrossSellModal() {
  const destination = useCartUi((s) => s.suggestionDestination);
  const crossSellSku = useCartUi((s) => s.crossSellSku);
  const lines = useCart((state) => state.lines);
  const skus = useMemo(() => lines.map((line) => line.sku), [lines]);
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

  useEffect(() => {
    const target = destination ?? "/korpa";
    if (!skus.length) {
      close();
      router.push(target);
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
          router.push(target);
          return;
        }
        setResult({ key: requestKey, products: next });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        close();
        router.push(target);
      });
    return () => controller.abort();
  }, [close, destination, requestKey, router, skus]);

  function continueToDestination() {
    const target = destination ?? "/korpa";
    close();
    router.push(target);
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent className="max-h-[90dvh] max-w-4xl overflow-y-auto bg-surface">
        <DialogHeader>
          <DialogTitle className="font-display text-xl text-ink-900">
            Predlog kupovine
          </DialogTitle>
          <DialogDescription className="text-ink-500">
            Pre nastavka možete brzo pogledati artikle koje je admin povezao sa proizvodima iz korpe.
          </DialogDescription>
        </DialogHeader>
        <PurchaseSuggestion products={products} />
        <DialogFooter className="bg-transparent">
          <Button type="button" variant="outline" onClick={close}>
            Ostani u kupovini
          </Button>
          <Button type="button" onClick={continueToDestination}>
            Nastavi
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
