"use client";

import { useEffect, useRef } from "react";
import { useSession } from "next-auth/react";
import { useCheckout } from "@/lib/checkout/store";
import { useCart } from "@/lib/hooks/use-cart";

/** Keeps a persisted voucher authoritative when cart prices or auth change. */
export function VoucherPricingSync() {
  const { data: session, status } = useSession();
  const hydrated = useCart((state) => state.hydrated);
  const lineCount = useCart((state) => state.lines.length);
  const subtotal = useCart((state) =>
    state.lines.reduce((sum, line) => sum + line.unitPriceSale * line.qty, 0),
  );
  const voucher = useCheckout((state) => state.voucher);
  const applyVoucher = useCheckout((state) => state.applyVoucher);
  const lastValidationKey = useRef<string | null>(null);
  const customerKey =
    status === "authenticated"
      ? String(session?.user?.email ?? session?.user?.name ?? "customer")
      : status;

  useEffect(() => {
    if (!hydrated || !voucher) return;
    if (!lineCount) {
      applyVoucher(null);
      return;
    }

    const voucherCode = voucher.code;
    const key = `${voucherCode}|${subtotal}|${customerKey}`;
    const subtotalIsCurrent = voucher.validatedSubtotalRsd === subtotal;
    if (subtotalIsCurrent && lastValidationKey.current === key) return;
    lastValidationKey.current = key;
    const controller = new AbortController();

    async function revalidate() {
      try {
        const response = await fetch("/api/voucher/validate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ code: voucherCode, subtotal }),
          signal: controller.signal,
        });
        const result = (await response.json().catch(() => null)) as
          | { ok: true; code: string; label: string; discountRsd: number }
          | { ok: false; reason: string }
          | null;
        if (!response.ok || !result?.ok) {
          applyVoucher(null);
          return;
        }
        applyVoucher({
          code: result.code,
          label: result.label,
          discountRsd: result.discountRsd,
          validatedSubtotalRsd: subtotal,
        });
      } catch (error) {
        if (!controller.signal.aborted) {
          console.warn("[voucher] Failed to refresh the applied voucher.", error);
        }
      }
    }

    void revalidate();
    return () => controller.abort();
  }, [
    applyVoucher,
    customerKey,
    hydrated,
    lineCount,
    subtotal,
    voucher,
  ]);

  return null;
}
