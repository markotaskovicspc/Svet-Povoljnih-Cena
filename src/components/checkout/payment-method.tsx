"use client";

import { useFormContext } from "react-hook-form";
import {
  CreditCard,
  Smartphone,
  Banknote,
  Receipt,
  Wallet,
  Apple,
  ScanLine,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { PaymentMethod } from "@/types";
import {
  PAYMENT_LABELS,
  type CheckoutPaymentMethodConfig,
} from "@/lib/checkout/config-shared";
import type { CheckoutFormData } from "./checkout-flow";

interface MethodMeta {
  icon: React.ElementType;
}

const METHOD_META: Record<PaymentMethod, MethodMeta> = {
  ips: {
    icon: ScanLine,
  },
  kartica: {
    icon: CreditCard,
  },
  google_pay: {
    icon: Wallet,
  },
  apple_pay: {
    icon: Apple,
  },
  uplata_na_racun: {
    icon: Receipt,
  },
  pouzece_gotovina: {
    icon: Banknote,
  },
  pouzece_kartica: {
    icon: Smartphone,
  },
};

/**
 * Step 5 — Payment method picker.
 */
export function PaymentMethodStep({
  methods,
}: {
  methods: CheckoutPaymentMethodConfig[];
}) {
  const { register, watch } = useFormContext<CheckoutFormData>();
  const active = watch("paymentMethod");

  if (!methods.length) {
    return (
      <div className="rounded-xl border border-action/30 bg-action/5 px-4 py-3 text-sm text-action">
        Trenutno nema aktivnih načina plaćanja. Kontaktirajte podršku ili
        pokušajte kasnije.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <fieldset
        data-testid="checkout-payment-methods"
        className="flex snap-x gap-3 overflow-x-auto p-0.5 pb-1.5 lg:gap-2.5"
      >
        {methods.map((method) => {
          const meta = METHOD_META[method.id];
          const Icon = meta.icon;
          const checked = active === method.id;
          const label =
            method.id === "uplata_na_racun" || method.id === "pouzece_gotovina"
              ? PAYMENT_LABELS[method.id]
              : method.label;
          return (
            <label
              key={method.id}
              htmlFor={`pay-${method.id}`}
              className={cn(
                "bg-surface ring-border/60 group flex min-w-[180px] flex-1 snap-start cursor-pointer items-center rounded-2xl p-4 ring-1 transition lg:p-3",
                "hover:ring-walnut/40",
                checked && "ring-walnut shadow-soft-2 ring-2",
              )}
            >
              <div className="flex w-full items-center gap-3">
                <span
                  className={cn(
                    "inline-flex size-9 items-center justify-center rounded-xl lg:size-8",
                    checked ? "bg-walnut text-canvas" : "bg-muted-bg text-ink-700",
                  )}
                  aria-hidden
                >
                  <Icon className="size-4" />
                </span>
                <span className="min-w-0 flex-1 text-sm font-medium text-ink-900">
                  {label}
                </span>
              </div>
              <input
                id={`pay-${method.id}`}
                type="radio"
                value={method.id}
                className="sr-only"
                {...register("paymentMethod")}
              />
            </label>
          );
        })}
      </fieldset>
    </div>
  );
}
