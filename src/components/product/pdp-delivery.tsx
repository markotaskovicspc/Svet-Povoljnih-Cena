"use client";

/**
 * Delivery & assembly section for PDP.
 * - Shows the global delivery window
 * - City picker (datalist autocomplete) — when chosen, indicates whether
 *   truck delivery and assembly are available
 * - Pricelist (kurirska / kamionska / montaža) — Phase 1 mock values, will
 *   be sourced from DeliveryRule rows in Phase 4
 */
import { useId, useState } from "react";
import { Check, Truck, Wrench, X } from "lucide-react";
import type { Product } from "@/types";
import { cn } from "@/lib/utils";
import { formatRsd } from "@/lib/format";

interface PdpDeliveryProps {
  product: Product;
  /** Optional address book cities (logged-in users); falls back to assembly cities. */
  knownCities?: string[];
  pricelist?: { courier: number; truck: number; assembly: number };
}

const DEFAULT_PRICELIST = { courier: 990, truck: 4990, assembly: 5990 };

export function PdpDelivery({
  product,
  knownCities,
  pricelist = DEFAULT_PRICELIST,
}: PdpDeliveryProps) {
  const inputId = useId();
  const listId = `${inputId}-cities`;
  const [city, setCity] = useState("");

  const cities = Array.from(
    new Set([...(knownCities ?? []), ...product.assemblyCities]),
  ).sort();

  const trimmed = city.trim();
  const cityLower = trimmed.toLowerCase();
  const truckCity = product.assemblyCities.find(
    (c) => c.toLowerCase() === cityLower,
  );
  const assemblyAvailable = !!truckCity && product.allowsAssembly;
  const showResult = trimmed.length >= 2;

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <div className="bg-muted-bg/60 ring-border/60 rounded-2xl p-5 ring-1">
        <h3 className="font-display text-lg text-ink-900">Isporuka</h3>
        <p className="mt-2 text-sm text-ink-700">
          Rok isporuke: {product.deliveryDays.min}–{product.deliveryDays.max} radnih
          dana od potvrde porudžbine.
        </p>

        <label
          htmlFor={inputId}
          className="mt-4 block text-xs font-medium tracking-wide text-ink-700 uppercase"
        >
          Vaš grad
        </label>
        <input
          id={inputId}
          list={listId}
          value={city}
          onChange={(e) => setCity(e.target.value)}
          placeholder="npr. Beograd"
          autoComplete="address-level2"
          className="bg-surface ring-border/60 focus-visible:ring-walnut/40 mt-1 w-full rounded-full px-4 py-2 text-sm ring-1 focus-visible:ring-2 focus-visible:outline-none"
        />
        <datalist id={listId}>
          {cities.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>

        {showResult ? (
          <ul className="mt-4 space-y-2 text-sm">
            <ResultRow
              ok={truckCity != null}
              label={
                truckCity
                  ? `Kamionska dostava dostupna za ${truckCity}`
                  : `Kamionska dostava nije dostupna za ${trimmed}`
              }
            />
            <ResultRow
              ok={assemblyAvailable}
              label={
                assemblyAvailable
                  ? "Montaža dostupna"
                  : product.allowsAssembly
                    ? "Montaža u ovom gradu nije dostupna"
                    : "Proizvod ne zahteva montažu"
              }
            />
          </ul>
        ) : (
          <p className="mt-4 text-xs text-ink-500">
            Unesite grad da proverite dostupnost kamionske dostave i montaže.
          </p>
        )}
      </div>

      <div className="bg-muted-bg/60 ring-border/60 rounded-2xl p-5 ring-1">
        <h3 className="font-display text-lg text-ink-900">Cenovnik</h3>
        <ul className="mt-3 divide-y divide-border/60 text-sm">
          <PriceRow
            icon={<Truck className="size-4" aria-hidden />}
            label="Kurirska dostava"
            price={formatRsd(pricelist.courier)}
          />
          <PriceRow
            icon={<Truck className="size-4" aria-hidden />}
            label="Kamionska dostava"
            price={formatRsd(pricelist.truck)}
          />
          <PriceRow
            icon={<Wrench className="size-4" aria-hidden />}
            label="Montaža"
            price={
              product.allowsAssembly ? formatRsd(pricelist.assembly) : "—"
            }
            muted={!product.allowsAssembly}
          />
        </ul>
        <p className="mt-3 text-[11px] text-ink-500">
          Konačna cena dostave i montaže potvrđuje se u koraku plaćanja.
        </p>
      </div>
    </div>
  );
}

function ResultRow({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li
      className={cn(
        "flex items-start gap-2",
        ok ? "text-success" : "text-ink-500",
      )}
    >
      {ok ? (
        <Check className="mt-0.5 size-4 shrink-0" aria-hidden />
      ) : (
        <X className="mt-0.5 size-4 shrink-0" aria-hidden />
      )}
      <span>{label}</span>
    </li>
  );
}

function PriceRow({
  icon,
  label,
  price,
  muted,
}: {
  icon: React.ReactNode;
  label: string;
  price: string;
  muted?: boolean;
}) {
  return (
    <li
      className={cn(
        "flex items-center justify-between py-2.5",
        muted && "text-ink-500",
      )}
    >
      <span className="inline-flex items-center gap-2">
        {icon}
        {label}
      </span>
      <span className="font-medium tabular-nums">{price}</span>
    </li>
  );
}
