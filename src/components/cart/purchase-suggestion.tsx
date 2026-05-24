"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import type { Product } from "@/types";
import { ProductCard } from "@/components/product/product-card";
import { useCart } from "@/lib/hooks/use-cart";

interface RecommendationsResponse {
  products?: Product[];
}

export function PurchaseSuggestion() {
  const lines = useCart((s) => s.lines);
  const skus = useMemo(() => lines.map((line) => line.sku), [lines]);
  const requestKey = skus.join("|");
  const [result, setResult] = useState<{ key: string; products: Product[] } | null>(null);

  useEffect(() => {
    if (!skus.length) return;

    const controller = new AbortController();
    fetch("/api/cart/recommendations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ skus, limit: 6 }),
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error("Recommendations unavailable");
        return response.json() as Promise<RecommendationsResponse>;
      })
      .then((data) =>
        setResult({
          key: requestKey,
          products: Array.isArray(data.products) ? data.products : [],
        }),
      )
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setResult({ key: requestKey, products: [] });
      });

    return () => controller.abort();
  }, [requestKey, skus]);

  const products = result?.key === requestKey ? result.products : [];
  const pending = skus.length > 0 && result?.key !== requestKey;

  if (pending) {
    return (
      <div className="flex min-h-32 items-center justify-center gap-2 rounded-lg bg-muted-bg/70 text-sm text-ink-500 ring-1 ring-border/60">
        <Loader2 className="size-4 animate-spin" aria-hidden />
        Učitavam predloge...
      </div>
    );
  }

  if (!products.length) {
    return (
      <div className="rounded-lg bg-muted-bg/70 p-4 text-sm leading-relaxed text-ink-700 ring-1 ring-border/60">
        Trenutno nema dodatnih predloga za artikle iz korpe.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {products.map((product) => (
        <ProductCard key={product.sku} product={product} className="h-full" />
      ))}
    </div>
  );
}
