import type { Product } from "@/types";
import type { FacetExtents, FacetValues } from "@/lib/listing/filters";

export interface ListingPagePayload {
  items?: Product[];
  nextCursor?: string | null;
  total?: number;
}

export interface ListingFacetsPayload {
  facets?: FacetValues;
  extents?: FacetExtents;
}

const RETRYABLE_ATTEMPTS = 3;

export async function fetchListingPage(
  params: URLSearchParams,
  signal?: AbortSignal,
  retryDelayMs = 1_000,
): Promise<ListingPagePayload> {
  return fetchListingJson<ListingPagePayload>(
    `/api/products?${params.toString()}`,
    signal,
    retryDelayMs,
  );
}

export async function fetchListingFacets(
  params: URLSearchParams,
  signal?: AbortSignal,
  retryDelayMs = 1_000,
): Promise<ListingFacetsPayload> {
  return fetchListingJson<ListingFacetsPayload>(
    `/api/products/facets?${params.toString()}`,
    signal,
    retryDelayMs,
  );
}

async function fetchListingJson<T>(
  url: string,
  signal: AbortSignal | undefined,
  retryDelayMs: number,
): Promise<T> {
  let lastStatus = 0;

  for (let attempt = 0; attempt < RETRYABLE_ATTEMPTS; attempt += 1) {
    const response = await fetch(url, {
      headers: { accept: "application/json" },
      signal,
    });
    if (response.ok) return (await response.json()) as T;

    lastStatus = response.status;
    if (response.status < 500 || attempt === RETRYABLE_ATTEMPTS - 1) break;
    await delay(retryDelayMs * 2 ** attempt, signal);
  }

  throw new Error(`HTTP ${lastStatus || "unavailable"}`);
}

function delay(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}
