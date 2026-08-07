import type { Product } from "@/types";

export interface ListingPagePayload {
  items?: Product[];
  nextCursor?: string | null;
  total?: number;
}

const RETRYABLE_ATTEMPTS = 2;

export async function fetchListingPage(
  params: URLSearchParams,
  signal?: AbortSignal,
  retryDelayMs = 750,
): Promise<ListingPagePayload> {
  let lastStatus = 0;

  for (let attempt = 0; attempt < RETRYABLE_ATTEMPTS; attempt += 1) {
    const response = await fetch(`/api/products?${params.toString()}`, {
      headers: { accept: "application/json" },
      signal,
    });
    if (response.ok) return (await response.json()) as ListingPagePayload;

    lastStatus = response.status;
    if (response.status < 500 || attempt === RETRYABLE_ATTEMPTS - 1) break;
    await delay(retryDelayMs, signal);
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
