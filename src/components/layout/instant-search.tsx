"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, ArrowRight, Loader2 } from "lucide-react";
import type { SearchSuggestion } from "@/types/search";
import { cn } from "@/lib/utils";
import { SearchSuggestionRow } from "./search-suggestion-row";
import {
  searchSuggestFailureMessage,
  useSearchSuggestions,
} from "./use-search-suggestions";

interface InstantSearchProps {
  className?: string;
  presentation?: "dropdown" | "inline";
  onNavigate?: () => void;
}

export function InstantSearch({
  className,
  presentation = "dropdown",
  onNavigate,
}: InstantSearchProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const {
    query,
    queryTrimmed,
    results,
    pending,
    failure,
    setQuery,
    retry: retrySearch,
  } = useSearchSuggestions(6);

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
    if (presentation !== "dropdown") return;
    const onClick = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open, presentation]);

  const goAll = useCallback(() => {
    if (!queryTrimmed) return;
    setOpen(false);
    router.push(`/pretraga?q=${encodeURIComponent(queryTrimmed)}`);
    onNavigate?.();
  }, [onNavigate, queryTrimmed, router]);

  const goHit = useCallback(
    (hit: SearchSuggestion) => {
      setOpen(false);
      router.push(hit.href);
      onNavigate?.();
    },
    [onNavigate, router],
  );

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      if (!open) return;
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, results.length));
    } else if (e.key === "ArrowUp") {
      if (!open) return;
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      goAll();
    }
  };

  const showPanel = open && (queryTrimmed.length >= 3 || results.length > 0 || pending);
  const panel = showPanel ? (
    <div
      className={cn(
        "overflow-hidden border border-border bg-surface shadow-soft-4",
        presentation === "dropdown"
          ? "absolute top-[calc(100%+8px)] right-0 left-0 z-50 rounded-2xl"
          : "static mt-3 rounded-xl shadow-none",
      )}
    >
      {pending ? (
        <div className="flex items-center gap-2 px-4 py-6 text-sm text-ink-500">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          Tražim...
        </div>
      ) : failure ? (
        <div className="space-y-3 px-4 py-5 text-sm text-ink-600" role="status">
          <p>{searchSuggestFailureMessage(failure)}</p>
          <button
            type="button"
            onClick={retrySearch}
            className="font-semibold text-walnut underline-offset-4 hover:underline"
          >
            Pokušaj ponovo
          </button>
        </div>
      ) : results.length === 0 ? (
        <div className="px-4 py-6 text-sm text-ink-500">
          {queryTrimmed.length < 3
            ? "Unesite najmanje 3 znaka."
            : `Nema rezultata za "${queryTrimmed}".`}
        </div>
      ) : (
        <>
          {queryTrimmed.length >= 3 ? (
            <button
              type="button"
              onClick={goAll}
              className={cn(
                "flex w-full items-center justify-between gap-2 border-b border-border px-4 py-3 text-sm font-semibold transition hover:bg-muted-bg",
                activeIndex === results.length ? "bg-muted-bg" : "",
              )}
            >
              <span className="text-ink-900">Vidi sve rezultate za {queryTrimmed}</span>
              <ArrowRight className="size-4 text-walnut" aria-hidden />
            </button>
          ) : null}
          <ul
            role="listbox"
            aria-label="Rezultati pretrage"
            className={cn(
              "overflow-y-auto py-1",
              presentation === "dropdown" ? "max-h-[60vh]" : "max-h-[calc(100dvh-260px)]",
            )}
          >
            {results.map((hit, i) => (
              <li
                key={hit.type === "product" ? hit.sku : `${hit.type}-${hit.id}`}
                role="none"
              >
                <SearchSuggestionRow
                  hit={hit}
                  active={activeIndex === i}
                  onActivate={() => setActiveIndex(i)}
                  onSelect={() => goHit(hit)}
                />
              </li>
            ))}
          </ul>
        </>
      )}
      {queryTrimmed.length >= 3 && results.length === 0 ? (
        <button
          type="button"
          onClick={goAll}
          className={cn(
            "flex w-full items-center justify-between gap-2 border-t border-border px-4 py-3 text-sm transition hover:bg-muted-bg",
            activeIndex === results.length ? "bg-muted-bg" : "",
          )}
        >
          <span className="text-ink-700">Vidi sve rezultate za {queryTrimmed}</span>
          <ArrowRight className="size-4 text-walnut" aria-hidden />
        </button>
      ) : null}
    </div>
  ) : null;

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
            const nextQuery = e.target.value;
            setQuery(nextQuery);
            setOpen(true);
            setActiveIndex(0);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Pretraži ponudu (min. 3 znaka)…"
          aria-label="Pretraga proizvoda"
          autoComplete="off"
          className="h-11 w-full rounded-full border border-border bg-surface pr-4 pl-9 text-base text-ink-900 placeholder:text-ink-500 transition outline-none focus-visible:border-walnut focus-visible:ring-2 focus-visible:ring-walnut/20 md:text-sm"
        />
      </div>

      {panel}
    </div>
  );
}
