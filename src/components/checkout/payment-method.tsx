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
import type { CheckoutFormData } from "./checkout-flow";

interface MethodMeta {
  id: PaymentMethod;
  label: string;
  icon: React.ElementType;
  short: string;
  details: React.ReactNode;
  disabled?: boolean;
}

const METHODS: MethodMeta[] = [
  {
    id: "ips",
    label: "IPS NBS",
    icon: ScanLine,
    short: "Payten IPS QR/deep-link plaćanje preko banke.",
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
          Posle potvrde porudžbine preusmeravamo vas na stranu banke gde se
          prikazuje QR kod ili otvara m-banking deep link.
        </p>
      </div>
    ),
  },
  {
    id: "kartica",
    label: "Platna kartica",
    icon: CreditCard,
    short: "Visa, Mastercard, DinaCard — uskoro nakon Raiffeisen aktivacije.",
    details: (
      <p>
        Kartično plaćanje uključujemo nakon završetka Raiffeisen e-commerce
        ugovora i dostavljene API dokumentacije za kartice.
      </p>
    ),
    disabled: true,
  },
  {
    id: "google_pay",
    label: "Google Pay",
    icon: Wallet,
    short: "Digitalni novčanik — biće dostupan uz kartičnu uslugu.",
    details: <p>Google Pay aktiviramo zajedno sa Raiffeisen kartičnim plaćanjem.</p>,
    disabled: true,
  },
  {
    id: "apple_pay",
    label: "Apple Pay",
    icon: Apple,
    short: "Digitalni novčanik — biće dostupan uz kartičnu uslugu.",
    details: (
      <p>Apple Pay aktiviramo zajedno sa Raiffeisen kartičnim plaćanjem.</p>
    ),
    disabled: true,
  },
  {
    id: "uplata_na_racun",
    label: "Uplata na račun",
    icon: Receipt,
    short: "Dobijate prilagođenu uplatnicu i podatke za nalog.",
    details: (
      <p>
        Pripremićemo uplatnicu sa pozivom na broj — nakon evidentiranja uplate
        kreće priprema porudžbine.
      </p>
    ),
  },
  {
    id: "pouzece_gotovina",
    label: "Pouzeće — gotovina",
    icon: Banknote,
    short: "Plaćate gotovinom kuriru pri preuzimanju pošiljke.",
    details: (
      <p>
        Pripremite tačan iznos u dinarima. Naknada za pouzeće biće prikazana u
        sažetku ako je primenljiva.
      </p>
    ),
  },
  {
    id: "pouzece_kartica",
    label: "Pouzeće — kartica",
    icon: Smartphone,
    short: "Kuriri imaju POS terminale za plaćanje karticom na vratima.",
    details: (
      <p>Plaćanje obavljate karticom direktno na POS terminalu kurira.</p>
    ),
  },
];

/**
 * Step 5 — Payment method picker. Selecting a card expands a helpful detail
 * block. Real WSPay / wallet handoff arrives in Phase 4.
 */
export function PaymentMethodStep() {
  const { register, watch } = useFormContext<CheckoutFormData>();
  const active = watch("paymentMethod");

  return (
    <fieldset className="grid gap-3 md:grid-cols-2">
      {METHODS.map((m) => {
        const Icon = m.icon;
        const checked = active === m.id;
        return (
          <label
            key={m.id}
            htmlFor={`pay-${m.id}`}
            className={cn(
              "bg-surface ring-border/60 group flex cursor-pointer flex-col gap-2 rounded-2xl p-4 ring-1 transition",
              "hover:ring-walnut/40",
              checked && "ring-walnut shadow-soft-2 ring-2",
              m.disabled && "cursor-not-allowed opacity-60 hover:ring-border/60",
            )}
          >
            <div className="flex items-start gap-3">
              <span
                className={cn(
                  "inline-flex size-9 items-center justify-center rounded-xl",
                  checked ? "bg-walnut text-canvas" : "bg-muted-bg text-ink-700",
                )}
                aria-hidden
              >
                <Icon className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-ink-900">
                  {m.label}
                  {m.disabled ? (
                    <span className="ml-2 rounded-full bg-muted-bg px-2 py-0.5 text-[10px] font-medium text-ink-500">
                      Uskoro
                    </span>
                  ) : null}
                </span>
                <span className="text-xs text-ink-500">{m.short}</span>
              </div>
            </div>
            {checked ? (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                className="border-border/60 mt-1 overflow-hidden border-t pt-2 text-xs text-ink-700"
              >
                {m.details}
              </motion.div>
            ) : null}
            <input
              id={`pay-${m.id}`}
              type="radio"
              value={m.id}
              className="sr-only"
              disabled={m.disabled}
              {...register("paymentMethod")}
            />
          </label>
        );
      })}
    </fieldset>
  );
}
