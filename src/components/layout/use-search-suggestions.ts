"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SearchSuggestion } from "@/types/search";

export type SearchSuggestFailure = "rate_limited" | "timeout" | "unavailable";

interface SuggestResponse {
  hits?: SearchSuggestion[];
}

class SearchSuggestHttpError extends Error {
  constructor(readonly status: number) {
    super(`Search suggest failed with status ${status}.`);
    this.name = "SearchSuggestHttpError";
  }
}

const SEARCH_SUGGEST_TIMEOUT_MS = 8_000;

export function searchSuggestFailureMessage(failure: SearchSuggestFailure) {
  if (failure === "rate_limited") {
    return "Previše brzih pretraga. Sačekajte trenutak pa pokušajte ponovo.";
  }
  if (failure === "timeout") {
    return "Pretraga traje duže nego obično. Pokušajte ponovo ili pritisnite Enter.";
  }
  return "Predlozi trenutno nisu dostupni. Pokušajte ponovo ili pritisnite Enter.";
}

export function useSearchSuggestions(limit = 6) {
  const [query, setQueryState] = useState("");
  const [debounced, setDebounced] = useState("");
  const [results, setResults] = useState<SearchSuggestion[]>([]);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<SearchSuggestFailure | null>(null);
  const [retryToken, setRetryToken] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const queryTrimmed = query.trim();

  useEffect(() => {
    if (queryTrimmed.length < 3) return;
    const id = window.setTimeout(() => setDebounced(queryTrimmed), 150);
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

    fetch(`/api/search/suggest?q=${encodeURIComponent(debounced)}&limit=${limit}`, {
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) throw new SearchSuggestHttpError(response.status);
        return response.json() as Promise<SuggestResponse>;
      })
      .then((data) => {
        if (live) setResults(Array.isArray(data.hits) ? data.hits : []);
      })
      .catch((error: unknown) => {
        if (!live || (controller.signal.aborted && !timedOut)) return;
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
        if (live) setPending(false);
      });

    return () => {
      live = false;
      window.clearTimeout(timeoutId);
      controller.abort();
      if (abortRef.current === controller) abortRef.current = null;
    };
  }, [debounced, limit, retryToken]);

  const setQuery = useCallback((nextQuery: string) => {
    setQueryState((currentQuery) => {
      const currentTrimmed = currentQuery.trim();
      const nextTrimmed = nextQuery.trim();
      if (currentTrimmed !== nextTrimmed) abortRef.current?.abort();
      if (nextTrimmed.length < 3) {
        setDebounced("");
        setResults([]);
        setPending(false);
        setFailure(null);
      } else if (currentTrimmed !== nextTrimmed) {
        setResults([]);
        setPending(true);
        setFailure(null);
      }
      return nextQuery;
    });
  }, []);

  const retry = useCallback(() => {
    if (queryTrimmed.length < 3) return;
    abortRef.current?.abort();
    setFailure(null);
    setResults([]);
    setPending(true);
    setDebounced(queryTrimmed);
    setRetryToken((token) => token + 1);
  }, [queryTrimmed]);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setQueryState("");
    setDebounced("");
    setResults([]);
    setPending(false);
    setFailure(null);
  }, []);

  return { query, queryTrimmed, results, pending, failure, setQuery, retry, reset };
}
