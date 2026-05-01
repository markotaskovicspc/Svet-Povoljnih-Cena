"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Search, ArrowRight, Loader2 } from "lucide-react";
import { searchProducts, type SearchHit } from "@/data/products";
import { formatRsd } from "@/lib/format";
import { cn } from "@/lib/utils";

interface InstantSearchProps {
  className?: string;
}

export function InstantSearch({ className }: InstantSearchProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [pending, setPending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Debounce query → debounced (150ms)
  useEffect(() => {
    if (query.trim().length < 3) {
      setDebounced("");
      setPending(false);
      return;
    }
    setPending(true);
    const id = window.setTimeout(() => {
      setDebounced(query);
      setPending(false);
    }, 150);
    return () => window.clearTimeout(id);
  }, [query]);

  const results: SearchHit[] = useMemo(
    () => (debounced ? searchProducts(debounced, 6) : []),
    [debounced],
  );

  // Reset highlight when results change
  useEffect(() => setActiveIndex(0), [debounced]);

  // Cmd-K / Ctrl-K to focus
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
        setOpen(true);
      }
      if (e.key === "Escape" && open) {
        setOpen(false);
        inputRef.current?.blur();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Click-outside to close
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const goAll = useCallback(() => {
    if (!query.trim()) return;
    setOpen(false);
    router.push(`/pretraga?q=${encodeURIComponent(query.trim())}`);
  }, [query, router]);

  const goHit = useCallback(
    (hit: SearchHit) => {
      setOpen(false);
      router.push(`/proizvod/${hit.slug}`);
    },
    [router],
  );

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, results.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const hit = results[activeIndex];
      if (hit) goHit(hit);
      else goAll();
    }
  };

  const showPanel =
    open && (query.trim().length >= 3 || results.length > 0 || pending);

  return (
    <div ref={containerRef} className={cn("relative w-full", className)}>
      <div className="relative">
        <Search
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-500"
          aria-hidden
        />
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Pretraži ponudu (min. 3 znaka)…"
          aria-label="Pretraga proizvoda"
          autoComplete="off"
          className="h-11 w-full rounded-full border border-border bg-surface pr-16 pl-9 text-sm text-ink-900 placeholder:text-ink-500 transition outline-none focus-visible:border-walnut focus-visible:ring-2 focus-visible:ring-walnut/20"
        />
        <kbd className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 rounded-md border border-border bg-muted-bg px-1.5 py-0.5 text-[10px] font-mono text-ink-500">
          ⌘K
        </kbd>
      </div>

      {showPanel ? (
        <div className="absolute top-[calc(100%+8px)] right-0 left-0 z-50 overflow-hidden rounded-2xl border border-border bg-surface shadow-soft-4">
          {pending ? (
            <div className="flex items-center gap-2 px-4 py-6 text-sm text-ink-500">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Tražim…
            </div>
          ) : results.length === 0 ? (
            <div className="px-4 py-6 text-sm text-ink-500">
              {query.trim().length < 3
                ? "Unesite najmanje 3 znaka."
                : `Nema rezultata za „${query.trim()}\u201d.`}
            </div>
          ) : (
            <ul role="listbox" aria-label="Rezultati pretrage" className="max-h-[60vh] overflow-y-auto py-1">
              {results.map((hit, i) => (
                <li key={hit.sku}>
                  <button
                    type="button"
                    onMouseEnter={() => setActiveIndex(i)}
                    onClick={() => goHit(hit)}
                    role="option"
                    aria-selected={activeIndex === i}
                    className={cn(
                      "flex w-full items-center gap-3 px-3 py-2 text-left transition",
                      activeIndex === i ? "bg-muted-bg" : "hover:bg-muted-bg/60",
                    )}
                  >
                    <div className="relative size-12 shrink-0 overflow-hidden rounded-lg bg-muted-bg">
                      {hit.thumbnailUrl ? (
                        <Image
                          src={hit.thumbnailUrl}
                          alt=""
                          fill
                          sizes="48px"
                          className="object-cover"
                        />
                      ) : null}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-ink-900">{hit.name}</div>
                      <div className="truncate font-mono text-[11px] text-ink-500">{hit.breadcrumb}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-semibold text-action">{formatRsd(hit.salePrice)}</div>
                      {hit.discountPct ? (
                        <div className="text-[11px] text-ink-500">−{hit.discountPct}%</div>
                      ) : null}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {query.trim().length >= 3 ? (
            <button
              type="button"
              onClick={goAll}
              className={cn(
                "flex w-full items-center justify-between gap-2 border-t border-border px-4 py-3 text-sm transition hover:bg-muted-bg",
                activeIndex === results.length ? "bg-muted-bg" : "",
              )}
            >
              <span className="text-ink-700">Vidi sve rezultate za „{query.trim()}\u201d</span>
              <ArrowRight className="size-4 text-walnut" aria-hidden />
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
