"use client";

import { useEffect, useState } from "react";
import { useFormContext } from "react-hook-form";
import { Loader2, MapPin, PackageOpen, Search, Truck, Wrench } from "lucide-react";
import { motion } from "framer-motion";
import { useCart } from "@/lib/hooks/use-cart";
import {
  SHIPPING_PRICES,
  ASSEMBLY_PRICE_DEFAULT,
} from "@/lib/checkout/store";
import { formatRsd } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CheckoutDeliveryPoint, CheckoutFormData } from "./checkout-flow";

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
export function ShippingMethodStep({
  glsDeliveryPointsEnabled = false,
}: {
  glsDeliveryPointsEnabled?: boolean;
}) {
  const { register, watch, setValue } = useFormContext<CheckoutFormData>();
  const lines = useCart((s) => s.lines);
  const city = watch("shipping.city");
  const method = watch("shippingMethod");
  const perItemAssembly = watch("perItemAssembly");
  const glsDeliveryPoint = watch("glsDeliveryPoint");

  const showKamion = city ? ASSEMBLY_CITY_ALLOWLIST.has(city.trim()) : true;

  useEffect(() => {
    if (method !== "kurir") {
      setValue("glsDeliveryPoint", null, { shouldDirty: true });
    }
  }, [method, setValue]);

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

      {glsDeliveryPointsEnabled && method === "kurir" ? (
        <GlsDeliveryPointPicker
          selected={glsDeliveryPoint ?? null}
          onSelect={(point) =>
            setValue("glsDeliveryPoint", point, {
              shouldDirty: true,
              shouldValidate: true,
            })
          }
        />
      ) : null}

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

function GlsDeliveryPointPicker({
  selected,
  onSelect,
}: {
  selected: CheckoutDeliveryPoint | null;
  onSelect: (point: CheckoutDeliveryPoint | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<CheckoutDeliveryPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const searchActive = query.trim().length >= 2;
  const visibleItems = searchActive ? items : [];

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      return;
    }
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/courier/delivery-points?q=${encodeURIComponent(trimmed)}`,
          { signal: controller.signal },
        );
        const json = (await res.json().catch(() => null)) as {
          items?: CheckoutDeliveryPoint[];
        } | null;
        setItems(json?.items ?? []);
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        setItems([]);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [query]);

  return (
    <div className="bg-surface ring-border/60 rounded-2xl p-4 ring-1">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-medium text-ink-900">
            <MapPin className="text-walnut size-4" aria-hidden />
            MyGLS paket tačka
          </div>
          <p className="mt-1 text-xs text-ink-500">
            Izaberite paket shop/locker ili ostavite dostavu na adresu.
          </p>
        </div>
        {selected ? (
          <button
            type="button"
            onClick={() => onSelect(null)}
            className="ring-border/70 hover:bg-muted-bg rounded-full px-3 py-1.5 text-xs font-medium text-ink-700 ring-1 transition"
          >
            Dostava na adresu
          </button>
        ) : null}
      </div>

      {selected ? (
        <div className="mt-3 rounded-xl border border-walnut/30 bg-walnut/5 px-3 py-2 text-sm text-ink-800">
          <p className="font-medium">{selected.name}</p>
          <p className="text-xs text-ink-600">
            {selected.label ?? [selected.street, selected.postalCode, selected.city].filter(Boolean).join(", ")}
          </p>
        </div>
      ) : null}

      <label className="relative mt-3 block">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-400" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Pretražite grad, adresu ili naziv"
          className="h-10 w-full rounded-xl border border-input bg-transparent pr-10 pl-9 text-sm outline-none transition focus:border-walnut"
        />
        {loading && searchActive ? (
          <Loader2 className="absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin text-ink-400" />
        ) : null}
      </label>

      {visibleItems.length ? (
        <ul className="mt-2 max-h-56 overflow-auto rounded-xl border border-border">
          {visibleItems.map((item) => (
            <li key={item.code}>
              <button
                type="button"
                onClick={() => onSelect(item)}
                className="hover:bg-muted-bg flex w-full flex-col px-3 py-2 text-left text-sm transition"
              >
                <span className="font-medium text-ink-900">{item.name}</span>
                <span className="text-xs text-ink-500">
                  {item.label ?? [item.street, item.postalCode, item.city].filter(Boolean).join(", ")}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : searchActive && !loading ? (
        <p className="mt-2 text-xs text-ink-500">Nema pronađenih MyGLS lokacija.</p>
      ) : null}
    </div>
  );
}
