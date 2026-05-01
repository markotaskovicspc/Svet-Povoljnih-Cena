"use client";

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
}

const METHODS: MethodMeta[] = [
  {
    id: "ips",
    label: "IPS NBS",
    icon: ScanLine,
    short: "Plaćanje QR kodom u banci ili m-banking aplikaciji.",
    details: (
      <p>
        Posle potvrde porudžbine prikazaćemo QR kod sa svim podacima — skenirajte
        ga unutar mobilne banke i potvrdite plaćanje.
      </p>
    ),
  },
  {
    id: "kartica",
    label: "Platna kartica",
    icon: CreditCard,
    short: "Visa, Mastercard, DinaCard — preko sigurne WSPay strane.",
    details: (
      <p>
        Preusmeravamo vas na zaštićenu WSPay stranu sa 3-D Secure validacijom.
        Vaši podaci sa kartice ne prolaze kroz naš sistem.
      </p>
    ),
  },
  {
    id: "google_pay",
    label: "Google Pay",
    icon: Wallet,
    short: "Brzo plaćanje uređajem koji je već prijavljen na Google Pay.",
    details: <p>Plaćanje se završava jednim potvrdjivanjem na vašem uređaju.</p>,
  },
  {
    id: "apple_pay",
    label: "Apple Pay",
    icon: Apple,
    short: "Brzo plaćanje na Apple uređajima sa Touch ID / Face ID.",
    details: (
      <p>Plaćanje se završava biometrijskom potvrdom na vašem Apple uređaju.</p>
    ),
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
              {...register("paymentMethod")}
            />
          </label>
        );
      })}
    </fieldset>
  );
}
