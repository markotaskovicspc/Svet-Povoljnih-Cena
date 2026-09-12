"use client";

// These flags live only in memory; no identifiers, cookies or storage are used.
const counted = new Set<string>();
export function countProductAr(slug: string, event: string) {
  if (!["model_opened", "ar_clicked", "ar_qr_landed"].includes(event)) return;
  const key = `${slug}:${event}`;
  if (event !== "ar_clicked" && counted.has(key)) return;
  try {
    void fetch("/api/product-ar/count", {
      method: "POST",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug, event }),
      keepalive: true,
    }).catch(() => undefined);
    // No retries: ambiguous failures must not inflate the totals.
    if (event !== "ar_clicked") counted.add(key);
  } catch { /* Counting must never interrupt the product experience. */ }
}
