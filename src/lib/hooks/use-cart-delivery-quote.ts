"use client";

import { useEffect, useState } from "react";
import type { CartLine } from "@/lib/hooks/use-cart";
import type { CheckoutDeliveryQuote } from "@/lib/checkout/config-shared";

export function useCartDeliveryQuote(
  lines: CartLine[],
  enabled = true,
) {
  const requestKey = JSON.stringify({
    city: null,
    lines: lines
      .map((line) => ({ sku: line.sku, qty: line.qty }))
      .sort((left, right) => left.sku.localeCompare(right.sku)),
  });
  const active = enabled && lines.length > 0;
  const [resolved, setResolved] = useState<{
    key: string;
    quote: CheckoutDeliveryQuote | null;
  } | null>(null);

  useEffect(() => {
    if (!active) return;

    const controller = new AbortController();
    void fetch("/api/checkout/delivery-quote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: requestKey,
    })
      .then(async (response) => {
        const result = (await response.json().catch(() => null)) as
          | { ok: true; data: CheckoutDeliveryQuote }
          | null;
        if (!controller.signal.aborted) {
          setResolved({
            key: requestKey,
            quote: response.ok && result?.ok ? result.data : null,
          });
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setResolved({ key: requestKey, quote: null });
        }
      });

    return () => controller.abort();
  }, [active, requestKey]);

  const isCurrent = active && resolved?.key === requestKey;
  return {
    quote: isCurrent ? resolved.quote : null,
    loading: active && !isCurrent,
  };
}
