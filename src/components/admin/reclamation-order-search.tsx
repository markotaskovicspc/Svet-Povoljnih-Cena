"use client";

import { useEffect, useId, useState } from "react";
import { Loader2, Search } from "lucide-react";
import { Field } from "@/components/admin/field";

type OrderSuggestion = {
  number: string;
  receiptNumber: string | null;
  createdAt: string;
  items: Array<{
    sku: string;
    name: string;
    availableQty: number;
  }>;
};

export function ReclamationOrderFields() {
  const listId = useId();
  const [value, setValue] = useState("");
  const [suggestions, setSuggestions] = useState<OrderSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [focused, setFocused] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<OrderSuggestion | null>(
    null,
  );

  useEffect(() => {
    const query = value.trim();
    if (query.length < 3) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setLoading(true);
      try {
        const response = await fetch(
          `/api/admin/reclamations/order-search?q=${encodeURIComponent(query)}`,
          { signal: controller.signal },
        );
        const result = (await response.json().catch(() => null)) as
          | { ok: true; data: OrderSuggestion[] }
          | null;
        setSuggestions(response.ok && result?.ok ? result.data : []);
      } catch (error) {
        if (!(error instanceof Error && error.name === "AbortError")) {
          setSuggestions([]);
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 250);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [value]);

  const open = focused && value.trim().length >= 3;

  return (
    <>
      <Field label="Broj porudžbine ili fiskalnog računa">
        <div className="relative">
          <Search
            className="pointer-events-none absolute top-3 left-3 size-4 text-ink-400"
            aria-hidden
          />
          <input
            name="orderNumberOrFiscal"
            required
            autoComplete="off"
            value={value}
            onChange={(event) => {
              const nextValue = event.target.value;
              setValue(nextValue);
              setSelectedOrder(null);
              if (nextValue.trim().length < 3) {
                setSuggestions([]);
                setLoading(false);
              }
            }}
            onFocus={() => setFocused(true)}
            onClick={() => setFocused(true)}
            onBlur={() => window.setTimeout(() => setFocused(false), 120)}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={open}
            aria-controls={listId}
            placeholder="Unesite najmanje 3 cifre, npr. 123"
            className="h-10 w-full rounded-lg border border-input bg-transparent pr-10 pl-9 text-sm"
          />
          {loading ? (
            <Loader2
              className="absolute top-3 right-3 size-4 animate-spin text-ink-400"
              aria-label="Pretražujem porudžbine"
            />
          ) : null}
          {open ? (
            <div
              id={listId}
              role="listbox"
              className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-border bg-white p-1 shadow-soft-2"
            >
              {suggestions.length ? (
                suggestions.map((order) => (
                  <button
                    key={order.number}
                    type="button"
                    role="option"
                    aria-selected={value === order.number}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      setValue(order.number);
                      setSelectedOrder(order);
                      setFocused(false);
                    }}
                    className="flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-sm transition hover:bg-muted-bg focus-visible:bg-muted-bg focus-visible:outline-none"
                  >
                    <span className="font-mono font-medium text-ink-900">
                      {order.number}
                    </span>
                    <span className="truncate text-xs text-ink-500">
                      {order.receiptNumber
                        ? `Račun ${order.receiptNumber}`
                        : new Date(order.createdAt).toLocaleDateString(
                            "sr-Latn-RS",
                          )}
                    </span>
                  </button>
                ))
              ) : loading ? null : (
                <p className="px-3 py-2 text-sm text-ink-500">
                  Nema isporučenih porudžbina sa tim nizom.
                </p>
              )}
            </div>
          ) : null}
        </div>
      </Field>
      <Field
        label="Artikal sa porudžbine"
        hint={
          selectedOrder
            ? "Prikazane su samo stavke sa preostalom količinom za reklamaciju."
            : "Prvo pronađite i izaberite porudžbinu."
        }
      >
        <select
          key={selectedOrder?.number ?? "unselected"}
          name="sku"
          required
          defaultValue=""
          disabled={!selectedOrder}
          className="h-10 w-full rounded-lg border border-input bg-transparent px-3 text-sm disabled:cursor-not-allowed disabled:opacity-60"
        >
          <option value="">
            {selectedOrder ? "Izaberite artikal" : "Izaberite porudžbinu"}
          </option>
          {selectedOrder?.items.map((item) => (
            <option key={item.sku} value={item.sku}>
              {item.sku} — {item.name} (dostupno {item.availableQty})
            </option>
          ))}
        </select>
      </Field>
    </>
  );
}
