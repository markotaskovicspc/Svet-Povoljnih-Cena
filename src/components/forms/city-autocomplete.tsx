"use client";

/**
 * City + postal-code autocomplete for the checkout shipping form.
 *
 * Usage:
 *   - User types ≥3 chars into the city input → suggestions appear.
 *   - Each suggestion shows "Naziv mesta — 12345".
 *   - Selecting a suggestion writes BOTH the city name and the postal code
 *     into react-hook-form via `setValue` so the postal-code field auto-fills.
 *
 * The suggestion list is keyboard-navigable (↑/↓/Enter/Esc) and closes on
 * outside click. Plays nicely with screen readers via aria-combobox.
 */
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  searchSerbianPlaces,
  type SerbianPlace,
} from "@/data/serbian-places";

interface CityAutocompleteProps {
  /** Currently typed city value (controlled). */
  value: string;
  /** Called whenever the user types (debounced display). */
  onValueChange: (next: string) => void;
  /**
   * Called when the user picks a suggestion. The form should use this to
   * also update the postal-code field.
   */
  onSelect: (place: SerbianPlace) => void;
  /** Field-level error from react-hook-form. */
  error?: string;
  /** Visual label above the input. */
  label?: string;
  /** Required marker styling. */
  required?: boolean;
  /** Minimum chars before suggestions appear (spec: 3). */
  minChars?: number;
  /** Native input id (used for label `htmlFor`). */
  id?: string;
  className?: string;
}

export function CityAutocomplete({
  value,
  onValueChange,
  onSelect,
  error,
  label = "Grad / mesto",
  required,
  minChars = 3,
  id,
  className,
}: CityAutocompleteProps) {
  const generatedId = useId();
  const inputId = id ?? `city-${generatedId}`;
  const listboxId = `${inputId}-listbox`;

  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const suggestions = useMemo(() => {
    if (value.trim().length < minChars) return [];
    return searchSerbianPlaces(value, 8);
  }, [value, minChars]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const pick = (place: SerbianPlace) => {
    onValueChange(place.name);
    onSelect(place);
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      setOpen(true);
      return;
    }
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      const hit = suggestions[boundedActive];
      if (hit) {
        e.preventDefault();
        pick(hit);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  const boundedActive = suggestions.length
    ? Math.min(active, suggestions.length - 1)
    : 0;
  const showPanel = open && value.trim().length >= minChars && suggestions.length > 0;

  return (
    <label
      htmlFor={inputId}
      className={cn("relative flex flex-col gap-1.5", className)}
    >
      <span className="text-xs font-medium text-ink-700">
        {label}
        {required ? <span className="text-action ml-0.5">*</span> : null}
      </span>
      <div ref={containerRef} className="relative">
        <MapPin
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-500"
          aria-hidden
        />
        <input
          id={inputId}
          type="text"
          value={value}
          onChange={(e) => {
            onValueChange(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          autoComplete="address-level2"
          role="combobox"
          aria-expanded={showPanel}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={
            showPanel ? `${listboxId}-opt-${boundedActive}` : undefined
          }
          aria-invalid={Boolean(error) || undefined}
          aria-describedby={error ? `${inputId}-err` : undefined}
          placeholder={`Unesite najmanje ${minChars} slova…`}
          className={cn(
            "ring-border/60 focus-visible:ring-walnut/40 bg-canvas h-11 w-full rounded-xl pr-3 pl-9 text-sm text-ink-900 ring-1 transition placeholder:text-ink-300",
            "focus-visible:ring-2 focus-visible:outline-none",
            error && "ring-action/60 focus-visible:ring-action/40",
          )}
        />

        {showPanel ? (
          <ul
            id={listboxId}
            role="listbox"
            className="absolute top-[calc(100%+6px)] right-0 left-0 z-30 max-h-[260px] overflow-y-auto rounded-2xl border border-border bg-surface py-1 shadow-soft-4"
          >
            {suggestions.map((place, i) => (
              <li
                key={`${place.postalCode}-${place.name}`}
                id={`${listboxId}-opt-${i}`}
                role="option"
                aria-selected={i === boundedActive}
              >
                <button
                  type="button"
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => {
                    // Prevent input blur before click resolves.
                    e.preventDefault();
                    pick(place);
                  }}
                  className={cn(
                    "flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition",
                    i === boundedActive
                      ? "bg-muted-bg text-ink-900"
                      : "text-ink-700 hover:bg-muted-bg/60",
                  )}
                >
                  <span className="truncate">{place.name}</span>
                  <span className="font-mono text-[11px] text-ink-500">
                    {place.postalCode}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {error ? (
        <span id={`${inputId}-err`} className="text-action text-[11px]">
          {error}
        </span>
      ) : null}
    </label>
  );
}
