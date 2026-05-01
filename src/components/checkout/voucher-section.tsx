"use client";

import { useState } from "react";
import { useFormContext } from "react-hook-form";
import { ChevronDown, Tag } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useCart } from "@/lib/hooks/use-cart";
import { useCheckout, validateVoucher } from "@/lib/checkout/store";
import { cn } from "@/lib/utils";
import type { CheckoutFormData } from "./checkout-flow";

/**
 * Step 4 — Voucher code (collapsible). Result is stored in checkout store so
 * the order summary can react. The mocked validator lives in the store; real
 * server-side validation lands in Phase 3.
 */
export function VoucherSection() {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { setValue } = useFormContext<CheckoutFormData>();
  const subtotal = useCart((s) =>
    s.lines.reduce((n, l) => n + l.unitPriceSale * l.qty, 0),
  );
  const applied = useCheckout((s) => s.voucher);
  const apply = useCheckout((s) => s.applyVoucher);

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const code = String(fd.get("code") ?? "");
    const result = validateVoucher(code, subtotal);
    if (result.ok) {
      apply(result.voucher);
      setValue("voucherCode", result.voucher.code, { shouldDirty: true });
      setError(null);
    } else {
      apply(null);
      setError(result.reason);
    }
  };

  return (
    <div className="bg-surface ring-border/60 rounded-2xl ring-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="focus-visible:ring-walnut/40 flex w-full items-center justify-between gap-3 rounded-2xl p-4 text-left focus-visible:ring-2 focus-visible:outline-none"
      >
        <span className="inline-flex items-center gap-2 text-sm font-medium text-ink-900">
          <Tag className="text-walnut size-4" aria-hidden />
          Imate voucher / promo kod?
        </span>
        <ChevronDown
          className={cn(
            "size-4 text-ink-500 transition-transform",
            open && "rotate-180",
          )}
          aria-hidden
        />
      </button>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            key="voucher-body"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <form
              onSubmit={onSubmit}
              className="border-border/60 flex flex-col gap-2 border-t p-4"
            >
              <div className="flex gap-2">
                <input
                  name="code"
                  defaultValue={applied?.code ?? ""}
                  placeholder="npr. SPRING-10"
                  className="ring-border/60 focus-visible:ring-walnut/40 bg-canvas h-10 flex-1 rounded-full px-3 text-sm text-ink-900 ring-1 transition focus-visible:ring-2 focus-visible:outline-none"
                />
                <button
                  type="submit"
                  className="bg-ink-900 hover:bg-walnut focus-visible:ring-walnut/40 inline-flex items-center rounded-full px-4 py-2 text-xs font-medium text-canvas transition focus-visible:ring-2 focus-visible:outline-none"
                >
                  Primeni
                </button>
              </div>
              {applied ? (
                <p className="text-success text-[11px]" aria-live="polite">
                  Kod „{applied.code}” je primenjen ({applied.label}).
                </p>
              ) : null}
              {error ? (
                <p className="text-action text-[11px]" aria-live="polite">
                  {error}
                </p>
              ) : null}
              <p className="text-[11px] text-ink-500">
                Demo kodovi: <span className="font-mono">SPRING-10</span>,{" "}
                <span className="font-mono">WELCOME-5</span>,{" "}
                <span className="font-mono">SPC-1500</span>.
              </p>
            </form>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
