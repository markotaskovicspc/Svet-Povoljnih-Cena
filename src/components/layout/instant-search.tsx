"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Search, ArrowRight, FolderTree, Layers3, Loader2 } from "lucide-react";
import type { SearchHit, SearchSuggestion } from "@/types/search";
import { formatRsd } from "@/lib/format";
import { cn } from "@/lib/utils";

interface InstantSearchProps {
  className?: string;
  presentation?: "dropdown" | "inline";
  onNavigate?: () => void;
}

interface SuggestResponse {
  hits?: SearchSuggestion[];
}

type SuggestFailure = "rate_limited" | "timeout" | "unavailable";

class SearchSuggestHttpError extends Error {
  constructor(readonly status: number) {
    super(`Search suggest failed with status ${status}.`);
    this.name = "SearchSuggestHttpError";
  }
}

const SEARCH_SUGGEST_TIMEOUT_MS = 8_000;

export function InstantSearch({
  className,
  presentation = "dropdown",
  onNavigate,
}: InstantSearchProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [results, setResults] = useState<SearchSuggestion[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<SuggestFailure | null>(null);
  const [retryToken, setRetryToken] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const queryTrimmed = query.trim();

  // Debounce query → debounced (150ms)
  useEffect(() => {
    if (queryTrimmed.length < 3) return;
    const id = window.setTimeout(() => {
      setDebounced(queryTrimmed);
    }, 150);
    return () => window.clearTimeout(id);
  }, [queryTrimmed]);

  useEffect(() => {
    if (!debounced) return;

    const controller = new AbortController();
    abortRef.current = controller;
    let live = true;
    let timedOut = false;
    const timeoutId = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, SEARCH_SUGGEST_TIMEOUT_MS);

    fetch(`/api/search/suggest?q=${encodeURIComponent(debounced)}&limit=6`, {
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) throw new SearchSuggestHttpError(response.status);
        return response.json() as Promise<SuggestResponse>;
      })
      .then((data) => {
        if (live) {
          setActiveIndex(0);
          setResults(Array.isArray(data.hits) ? data.hits : []);
        }
      })
      .catch((error: unknown) => {
        if (!live) return;
        if (controller.signal.aborted && !timedOut) return;
        setResults([]);
        setFailure(
          timedOut
            ? "timeout"
            : error instanceof SearchSuggestHttpError && error.status === 429
              ? "rate_limited"
              : "unavailable",
        );
      })
      .finally(() => {
        window.clearTimeout(timeoutId);
        if (live && !controller.signal.aborted) setPending(false);
        if (live && timedOut) setPending(false);
      });

    return () => {
      live = false;
      window.clearTimeout(timeoutId);
      controller.abort();
      if (abortRef.current === controller) abortRef.current = null;
    };
  }, [debounced, retryToken]);

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

  const retrySearch = useCallback(() => {
    if (queryTrimmed.length < 3) return;
    abortRef.current?.abort();
    setFailure(null);
    setResults([]);
    setPending(true);
    setRetryToken((token) => token + 1);
  }, [queryTrimmed]);

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
          <p>
            {failure === "rate_limited"
              ? "Previše brzih pretraga. Sačekajte trenutak pa pokušajte ponovo."
              : failure === "timeout"
                ? "Pretraga traje duže nego obično. Pokušajte ponovo ili pritisnite Enter."
                : "Predlozi trenutno nisu dostupni. Pokušajte ponovo ili pritisnite Enter."}
          </p>
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
              <li key={hit.type === "product" ? hit.sku : `${hit.type}-${hit.id}`}>
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
                  <div className="relative grid size-12 shrink-0 place-items-center overflow-hidden rounded-lg bg-white text-walnut ring-1 ring-border/60">
                    {hit.type === "product" && hit.thumbnailUrl ? (
                      <Image
                        src={hit.thumbnailUrl}
                        alt=""
                        fill
                        sizes="48px"
                        className="object-contain p-1"
                      />
                    ) : hit.type === "category" ? (
                      <FolderTree className="size-5" aria-hidden />
                    ) : hit.type === "group" ? (
                      <Layers3 className="size-5" aria-hidden />
                    ) : null}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-ink-900">{hit.name}</div>
                    <div className="truncate font-mono text-[11px] text-ink-500">
                      {hit.breadcrumb}
                    </div>
                  </div>
                  {hit.type === "product" ? <SearchHitPrices hit={hit} /> : null}
                </button>
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
            const nextTrimmed = nextQuery.trim();
            const trimmedChanged = nextTrimmed !== queryTrimmed;
            if (trimmedChanged) abortRef.current?.abort();
            setQuery(nextQuery);
            setOpen(true);
            if (trimmedChanged) setActiveIndex(0);
            if (nextTrimmed.length < 3) {
              setDebounced("");
              setResults([]);
              setPending(false);
              setFailure(null);
            } else if (trimmedChanged) {
              setResults([]);
              setPending(true);
              setFailure(null);
            }
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

function SearchHitPrices({ hit }: { hit: SearchHit }) {
  const hasReducedPrice = Boolean(hit.actionPrice || hit.loyaltyPrice);
  return (
    <div className="shrink-0 text-right text-[11px] leading-tight">
      {hasReducedPrice ? (
        <div className="text-ink-400 line-through">{formatRsd(hit.fullPrice)}</div>
      ) : (
        <div className="text-sm font-semibold text-ink-900">
          {formatRsd(hit.fullPrice)}
        </div>
      )}
      {hit.actionPrice ? (
        <div className="font-semibold text-action">
          Akcija {formatRsd(hit.actionPrice)}
        </div>
      ) : null}
      {hit.loyaltyPrice ? (
        <div className="font-semibold text-walnut">
          Loyalty {formatRsd(hit.loyaltyPrice)}
        </div>
      ) : null}
    </div>
  );
}
