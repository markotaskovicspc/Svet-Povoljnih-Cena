"use client";

import Image from "next/image";
import { useFormContext } from "react-hook-form";
import { motion } from "framer-motion";
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
import type { CheckoutPaymentMethodConfig } from "@/lib/checkout/config-shared";
import type { CheckoutFormData } from "./checkout-flow";

interface MethodMeta {
  id: PaymentMethod;
  icon: React.ElementType;
  short: string;
  details: React.ReactNode;
}

const METHOD_META: Record<PaymentMethod, MethodMeta> = {
  ips: {
    id: "ips",
    icon: ScanLine,
    short: "Raiffeisen IPS QR/deep-link plaćanje preko m-banking aplikacije.",
    details: (
      <div className="flex flex-col gap-2">
        <Image
          src="/icons/ips-skeniraj.svg"
          alt="IPS Skeniraj"
          width={110}
          height={36}
          className="h-9 w-auto"
        />
        <p>
          Posle potvrde porudžbine preusmeravamo vas na Raiffeisen IPS stranu
          gde se prikazuje QR kod ili otvara m-banking deep link.
        </p>
      </div>
    ),
  },
  kartica: {
    id: "kartica",
    icon: CreditCard,
    short: "Visa, Mastercard, DinaCard — kartično plaćanje preko WSPay-a.",
    details: (
      <p>
        Kartično plaćanje ide odvojeno od IPS-a, preko WSPay hosted strane i
        3-D Secure provere.
      </p>
    ),
  },
  google_pay: {
    id: "google_pay",
    icon: Wallet,
    short: "Digitalni novčanik — biće dostupan uz kartičnu uslugu.",
    details: <p>Google Pay radi kroz kartični WSPay tok kada je metod aktivan.</p>,
  },
  apple_pay: {
    id: "apple_pay",
    icon: Apple,
    short: "Digitalni novčanik — biće dostupan uz kartičnu uslugu.",
    details: (
      <p>Apple Pay radi kroz kartični WSPay tok kada je metod aktivan.</p>
    ),
  },
  uplata_na_racun: {
    id: "uplata_na_racun",
    icon: Receipt,
    short: "Dobijate prilagođenu uplatnicu i podatke za nalog.",
    details: (
      <p>
        Pripremićemo uplatnicu sa pozivom na broj — nakon evidentiranja uplate
        kreće priprema porudžbine.
      </p>
    ),
  },
  pouzece_gotovina: {
    id: "pouzece_gotovina",
    icon: Banknote,
    short: "Plaćate gotovinom kuriru pri preuzimanju pošiljke.",
    details: (
      <p>
        Pripremite tačan iznos u dinarima. Naknada za pouzeće biće prikazana u
        sažetku ako je primenljiva.
      </p>
    ),
  },
  pouzece_kartica: {
    id: "pouzece_kartica",
    icon: Smartphone,
    short: "Kuriri imaju POS terminale za plaćanje karticom na vratima.",
    details: (
      <p>Plaćanje obavljate karticom direktno na POS terminalu kurira.</p>
    ),
  },
};

/**
 * Step 5 — Payment method picker. Selecting a card expands a helpful detail
 * block. Real WSPay / wallet handoff arrives in Phase 4.
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
    <fieldset className="grid gap-3 md:grid-cols-2 lg:gap-2.5">
      {methods.map((method) => {
        const meta = METHOD_META[method.id];
        const Icon = meta.icon;
        const checked = active === method.id;
        return (
          <label
            key={method.id}
            htmlFor={`pay-${method.id}`}
            className={cn(
              "bg-surface ring-border/60 group flex cursor-pointer flex-col gap-2 rounded-2xl p-4 ring-1 transition lg:gap-1.5 lg:p-3",
              "hover:ring-walnut/40",
              checked && "ring-walnut shadow-soft-2 ring-2",
            )}
          >
            <div className="flex items-start gap-3">
              <span
                className={cn(
                  "inline-flex size-9 items-center justify-center rounded-xl lg:size-8",
                  checked ? "bg-walnut text-canvas" : "bg-muted-bg text-ink-700",
                )}
                aria-hidden
              >
                <Icon className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-ink-900">
                  {method.label}
                </span>
                <span className="text-xs text-ink-500">
                  {method.note || meta.short}
                </span>
              </div>
            </div>
            {checked ? (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                className="border-border/60 mt-1 overflow-hidden border-t pt-2 text-xs text-ink-700 lg:pt-1.5"
              >
                {method.note ? <p>{method.note}</p> : meta.details}
              </motion.div>
            ) : null}
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
  );
}
