"use client";

import { useFormContext } from "react-hook-form";
import { Truck, PackageOpen, Wrench } from "lucide-react";
import { motion } from "framer-motion";
import { useCart } from "@/lib/hooks/use-cart";
import {
  SHIPPING_PRICES,
  ASSEMBLY_PRICE_DEFAULT,
} from "@/lib/checkout/store";
import { formatRsd } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CheckoutFormData } from "./checkout-flow";

const ASSEMBLY_CITY_ALLOWLIST = new Set([
  "Beograd",
  "Novi Sad",
  "Niš",
  "Kragujevac",
  "Subotica",
  "Pančevo",
]);

/**
 * Step 3 — Shipping method.
 * Kamionska is hidden for cities outside the assembly allowlist.
 * When selected, every cart line gets a per-item assembly toggle.
 */
export function ShippingMethodStep() {
  const { register, watch, setValue } = useFormContext<CheckoutFormData>();
  const lines = useCart((s) => s.lines);
  const city = watch("shipping.city");
  const method = watch("shippingMethod");
  const perItemAssembly = watch("perItemAssembly");

  const showKamion = city ? ASSEMBLY_CITY_ALLOWLIST.has(city.trim()) : true;

  return (
    <div className="flex flex-col gap-4">
      <fieldset className="grid gap-3 sm:grid-cols-2">
        <MethodCard
          id="kurir"
          label="Kurirska služba"
          desc="Brza dostava manjih pakovanja na adresu (1–3 dana)."
          price={SHIPPING_PRICES.kurir}
          icon={Truck}
          checked={method === "kurir"}
          {...register("shippingMethod")}
        />
        {showKamion ? (
          <MethodCard
            id="kamion"
            label="Kamionska isporuka"
            desc="Za nameštaj velikih dimenzija — uključuje unos do stana."
            price={SHIPPING_PRICES.kamion}
            icon={PackageOpen}
            checked={method === "kamion"}
            {...register("shippingMethod")}
          />
        ) : (
          <div className="bg-muted-bg ring-border/60 rounded-2xl p-4 text-xs text-ink-500 ring-1">
            Kamionska isporuka u vašem gradu trenutno nije dostupna. Promenite
            grad u koraku „Podaci za isporuku” za druge opcije.
          </div>
        )}
      </fieldset>

      {method === "kamion" && lines.length > 0 ? (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          className="bg-surface ring-border/60 rounded-2xl p-4 ring-1"
        >
          <div className="mb-3 flex items-center gap-2 text-sm text-ink-900">
            <Wrench className="text-walnut size-4" aria-hidden />
            <span className="font-medium">Montaža po stavki</span>
            <span className="text-xs text-ink-500">
              (uključuje montažu od strane našeg tima)
            </span>
          </div>
          <ul className="divide-border/60 divide-y">
            {lines.map((l) => (
              <li
                key={l.sku}
                className="flex items-center justify-between gap-3 py-3 text-sm"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-ink-900">{l.name}</p>
                  <p className="text-[11px] text-ink-500">SKU {l.sku}</p>
                </div>
                <span className="text-walnut text-xs font-medium tabular-nums">
                  +{formatRsd(ASSEMBLY_PRICE_DEFAULT)}
                </span>
                <label className="inline-flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    className="accent-walnut size-4"
                    checked={Boolean(perItemAssembly?.[l.sku])}
                    onChange={(e) =>
                      setValue(
                        "perItemAssembly",
                        {
                          ...(perItemAssembly ?? {}),
                          [l.sku]: e.target.checked,
                        },
                        { shouldDirty: true },
                      )
                    }
                  />
                  <span className="text-xs text-ink-700">Dodaj montažu</span>
                </label>
              </li>
            ))}
          </ul>
        </motion.div>
      ) : null}
    </div>
  );
}

const MethodCard = ({
  id,
  label,
  desc,
  price,
  icon: Icon,
  checked,
  ...props
}: {
  id: string;
  label: string;
  desc: string;
  price: number;
  icon: React.ElementType;
  checked: boolean;
} & React.ComponentProps<"input">) => (
  <label
    htmlFor={`ship-${id}`}
    className={cn(
      "bg-surface ring-border/60 group flex cursor-pointer flex-col gap-2 rounded-2xl p-4 ring-1 transition",
      "hover:ring-walnut/40",
      checked && "ring-walnut shadow-soft-2 ring-2",
    )}
  >
    <div className="flex items-start justify-between gap-3">
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "inline-flex size-9 items-center justify-center rounded-xl",
            checked ? "bg-walnut text-canvas" : "bg-muted-bg text-ink-700",
          )}
          aria-hidden
        >
          <Icon className="size-4" />
        </span>
        <div>
          <span className="block text-sm font-medium text-ink-900">{label}</span>
          <span className="text-xs text-ink-500">{desc}</span>
        </div>
      </div>
      <span className="text-walnut text-sm font-medium tabular-nums">
        {formatRsd(price)}
      </span>
    </div>
    <input
      id={`ship-${id}`}
      type="radio"
      value={id}
      className="sr-only"
      {...props}
    />
  </label>
);
