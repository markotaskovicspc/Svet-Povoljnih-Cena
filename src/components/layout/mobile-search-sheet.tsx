"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Loader2, Search } from "lucide-react";
import type { SearchSuggestion } from "@/types/search";
import type { MobileSearchContent } from "@/types/mobile-search";
import { cn } from "@/lib/utils";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { SearchSuggestionRow } from "./search-suggestion-row";
import {
  searchSuggestFailureMessage,
  useSearchSuggestions,
} from "./use-search-suggestions";

export function MobileSearchSheet({
  content,
  compact = false,
}: {
  content: MobileSearchContent;
  compact?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [interactive, setInteractive] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const {
    query,
    queryTrimmed,
    results,
    pending,
    failure,
    setQuery,
    retry,
    reset,
  } = useSearchSuggestions(6);

  const close = useCallback(() => {
    setOpen(false);
    reset();
    setActiveIndex(0);
  }, [reset]);

  const navigate = useCallback((href: string) => {
    close();
    router.push(href);
  }, [close, router]);

  const goAll = useCallback(() => {
    navigate(
      queryTrimmed.length >= 3
        ? `/pretraga?q=${encodeURIComponent(queryTrimmed)}`
        : content.defaultViewAllHref,
    );
  }, [content.defaultViewAllHref, navigate, queryTrimmed]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setInteractive(true));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => inputRef.current?.focus(), 100);
    return () => window.clearTimeout(id);
  }, [open]);

  const goHit = (hit: SearchSuggestion) => navigate(hit.href);
  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" && results.length) {
      event.preventDefault();
      setActiveIndex((index) => Math.min(index + 1, results.length - 1));
    } else if (event.key === "ArrowUp" && results.length) {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (results[activeIndex]) goHit(results[activeIndex]);
      else goAll();
    }
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) reset();
      }}
    >
      <SheetTrigger
        aria-label="Pretraži"
        aria-busy={!interactive}
        disabled={!interactive}
        className={cn(
          "flex w-full items-center justify-between rounded-lg border border-border bg-white text-left text-ink-400 shadow-soft-1 transition hover:border-brand-blue/35 hover:text-ink-500 focus-visible:ring-2 focus-visible:ring-brand-blue/35 focus-visible:outline-none disabled:cursor-wait disabled:opacity-70",
          compact ? "h-10 gap-2 px-3 text-xs" : "h-11 gap-3 px-4 text-sm",
        )}
      >
        <span>Pretraga proizvoda...</span>
        <Search
          className={cn(
            "shrink-0 text-brand-blue",
            compact ? "size-4" : "size-5",
          )}
          aria-hidden
        />
      </SheetTrigger>
      <SheetContent
        side="top"
        showCloseButton={false}
        aria-describedby={undefined}
        className="!inset-0 !h-[100dvh] !w-screen !max-w-none gap-0 overflow-hidden rounded-none border-0 bg-white p-0 shadow-none"
      >
        <SheetTitle className="sr-only">Mobilna pretraga proizvoda</SheetTitle>
        <header className="shrink-0 border-b border-border bg-muted-bg px-3 pt-[max(env(safe-area-inset-top),0.75rem)] pb-3 shadow-[0_2px_8px_rgba(26,23,20,0.09)]">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={close}
              aria-label="Nazad"
              className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-brand-blue transition hover:bg-white focus-visible:ring-2 focus-visible:ring-brand-blue/35 focus-visible:outline-none"
            >
              <ArrowLeft className="size-6" aria-hidden />
            </button>
            <div className="relative min-w-0 flex-1">
              <input
                ref={inputRef}
                type="search"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setActiveIndex(0);
                }}
                onKeyDown={handleKeyDown}
                placeholder="Pretraga proizvoda…"
                aria-label="Pretraga proizvoda"
                aria-controls="mobile-search-results"
                aria-autocomplete="list"
                aria-activedescendant={
                  queryTrimmed.length >= 3 && results[activeIndex]
                    ? `mobile-search-result-${activeIndex}`
                    : undefined
                }
                autoComplete="off"
                enterKeyHint="search"
                className="h-13 w-full rounded-lg border border-border bg-white pr-12 pl-4 text-base text-ink-900 shadow-soft-1 outline-none placeholder:text-ink-400 focus-visible:border-brand-blue focus-visible:ring-2 focus-visible:ring-brand-blue/20"
              />
              <Search className="pointer-events-none absolute top-1/2 right-4 size-6 -translate-y-1/2 text-brand-blue" aria-hidden />
            </div>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-white px-5 pt-5 pb-[max(env(safe-area-inset-bottom),1.5rem)]">
          {queryTrimmed.length >= 3 ? (
            <section id="mobile-search-results" aria-labelledby="mobile-search-results-title" className="mb-6 border-b border-border pb-6">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 id="mobile-search-results-title" className="text-base font-semibold text-ink-700">Rezultati pretrage</h2>
                {!pending ? <span className="text-xs text-ink-500" aria-live="polite">{failure ? "Greška" : `${results.length} predloga`}</span> : null}
              </div>
              {pending ? (
                <div className="flex min-h-20 items-center gap-2 rounded-lg bg-muted-bg px-4 text-sm text-ink-500" role="status">
                  <Loader2 className="size-4 animate-spin" aria-hidden /> Tražim...
                </div>
              ) : failure ? (
                <div className="space-y-3 rounded-lg bg-muted-bg px-4 py-4 text-sm text-ink-600" role="status">
                  <p>{searchSuggestFailureMessage(failure)}</p>
                  <button type="button" onClick={retry} className="min-h-11 font-semibold text-brand-blue underline-offset-4 hover:underline">Pokušaj ponovo</button>
                </div>
              ) : results.length ? (
                <ul role="listbox" aria-label="Rezultati pretrage" className="divide-y divide-border/60">
                  {results.map((hit, index) => (
                    <li
                      key={hit.type === "product" ? hit.sku : `${hit.type}-${hit.id}`}
                      role="none"
                    >
                      <SearchSuggestionRow
                        id={`mobile-search-result-${index}`}
                        hit={hit}
                        active={index === activeIndex}
                        wrapName
                        onActivate={() => setActiveIndex(index)}
                        onSelect={() => goHit(hit)}
                        className="px-0"
                      />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="rounded-lg bg-muted-bg px-4 py-5 text-sm text-ink-500" role="status">Nema predloga za „{queryTrimmed}“.</p>
              )}
              <button type="button" onClick={goAll} className="mt-3 flex min-h-11 w-full items-center justify-between gap-3 rounded-lg bg-brand-blue px-4 text-left text-sm font-semibold text-white transition hover:bg-brand-blue/90">
                <span>Vidi sve rezultate za „{queryTrimmed}“</span><ArrowRight className="size-4 shrink-0" aria-hidden />
              </button>
            </section>
          ) : queryTrimmed.length ? (
            <p className="mb-5 rounded-lg bg-muted-bg px-4 py-3 text-sm text-ink-500" role="status">Unesite najmanje 3 znaka za rezultate.</p>
          ) : null}

          <section aria-labelledby="mobile-search-current-title" className="border-b border-border pb-6">
            <h2 id="mobile-search-current-title" className="mb-4 text-base font-medium text-ink-600">Aktuelno</h2>
            <div className="space-y-3">
              {content.currentItems.map((item) => (
                <button key={item.id} type="button" onClick={() => navigate(item.href)} className="group flex min-h-14 w-full items-center gap-4 rounded-lg text-left focus-visible:ring-2 focus-visible:ring-brand-blue/35 focus-visible:outline-none">
                  <span className="relative block size-14 shrink-0 overflow-hidden rounded-md bg-muted-bg ring-1 ring-border/50">
                    {item.imageUrl ? <Image src={item.imageUrl} alt="" fill sizes="56px" className="object-cover transition group-hover:scale-105" /> : null}
                  </span>
                  <span className="min-w-0 flex-1 text-base font-medium text-ink-900">{item.label}</span>
                  <ArrowRight className="size-4 shrink-0 text-brand-blue" aria-hidden />
                </button>
              ))}
            </div>
          </section>

          <section aria-labelledby="mobile-search-popular-title" className="border-b border-border py-6">
            <h2 id="mobile-search-popular-title" className="mb-4 text-base font-medium text-ink-600">Najpopularniji proizvodi</h2>
            <ul className="divide-y divide-border/50">
              {content.popularProducts.map((product) => (
                <li key={product.sku}>
                  <SearchSuggestionRow hit={product} role={null} wrapName onSelect={() => navigate(product.href)} className="px-0 py-3" />
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="mobile-search-frequent-title" className="py-6">
            <h2 id="mobile-search-frequent-title" className="mb-3 text-base font-medium text-ink-600">Najčešće pretrage</h2>
            <ul>
              {content.frequentQueries.map((term) => (
                <li key={term}>
                  <button type="button" onClick={() => navigate(`/pretraga?q=${encodeURIComponent(term)}`)} className="flex min-h-12 w-full items-center justify-between gap-3 text-left text-base text-ink-900 transition hover:text-brand-blue focus-visible:ring-2 focus-visible:ring-brand-blue/35 focus-visible:outline-none">
                    <span>{term}</span><ArrowRight className="size-4 shrink-0 text-brand-blue" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <button
            type="button"
            onClick={goAll}
            className={cn(
              "flex min-h-13 w-full items-center justify-between gap-3 rounded-lg px-5 text-left text-base font-semibold transition focus-visible:ring-2 focus-visible:ring-brand-blue/35 focus-visible:outline-none",
              "bg-action text-white hover:bg-action/90",
            )}
          >
            <span>Pogledaj sve</span><ArrowRight className="size-5 shrink-0" aria-hidden />
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
