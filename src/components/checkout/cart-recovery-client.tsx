"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useCart, type CartLine } from "@/lib/hooks/use-cart";
import { useCheckout } from "@/lib/checkout/store";

export function CartRecoveryClient({
  lines,
  voucherCode,
}: {
  lines: CartLine[];
  voucherCode?: string | null;
}) {
  const router = useRouter();
  const hydrated = useCart((state) => state.hydrated);
  const restore = useCart((state) => state.restore);
  const applyVoucher = useCheckout((state) => state.applyVoucher);
  const started = useRef(false);
  const [message, setMessage] = useState("Obnavljamo vašu korpu…");

  useEffect(() => {
    if (!hydrated || started.current) return;
    started.current = true;
    restore(lines);

    async function finish() {
      if (voucherCode) {
        const subtotal = lines.reduce(
          (sum, line) => sum + line.unitPriceSale * line.qty,
          0,
        );
        const response = await fetch("/api/voucher/validate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ code: voucherCode, subtotal }),
        }).catch(() => null);
        const result = (await response?.json().catch(() => null)) as
          | { ok: true; code: string; label: string; discountRsd: number }
          | null;
        if (result?.ok) {
          applyVoucher({
            code: result.code,
            label: result.label,
            discountRsd: result.discountRsd,
            validatedSubtotalRsd: subtotal,
          });
        }
      }
      setMessage("Korpa je obnovljena. Preusmeravamo vas…");
      router.replace("/korpa");
    }

    void finish();
  }, [applyVoucher, hydrated, lines, restore, router, voucherCode]);

  return (
    <main className="grid min-h-[60vh] place-items-center px-4 py-12">
      <section className="bg-surface ring-border/60 w-full max-w-lg rounded-2xl p-8 text-center shadow-soft-2 ring-1">
        <span className="bg-muted-bg text-walnut mx-auto inline-flex size-14 items-center justify-center rounded-full">
          <Loader2 className="size-6 animate-spin" aria-hidden />
        </span>
        <h1 className="font-display mt-4 text-2xl text-ink-900">
          Vraćamo proizvode u korpu
        </h1>
        <p className="mt-2 text-sm text-ink-500" aria-live="polite">
          {message}
        </p>
      </section>
    </main>
  );
}
