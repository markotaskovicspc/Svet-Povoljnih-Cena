"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ProductArAsset } from "@/types";

/** Refresh the small manifest after a deployment, while model files stay immutable. */
export function useCurrentProductAr(slug: string, initial?: ProductArAsset) {
  const [current, setCurrent] = useState({ slug, asset: initial });
  const lastChecked = useRef(0);
  const refresh = useCallback(async () => {
    if (!initial || Date.now() - lastChecked.current < 30_000) return;
    lastChecked.current = Date.now();
    try {
      const response = await fetch(`/api/product-ar/${encodeURIComponent(slug)}`, { cache: "no-store" });
      if (!response.ok) return;
      const asset: ProductArAsset = await response.json();
      if (!asset?.glbUrl || !asset.usdzUrl || !asset.posterUrl || !asset.dimensionsCm) return;
      setCurrent(previous => previous.slug === slug && JSON.stringify(previous.asset) === JSON.stringify(asset)
        ? previous : { slug, asset });
    } catch { /* A connection failure keeps the already usable model. */ }
  }, [slug, initial]);

  useEffect(() => {
    lastChecked.current = 0;
    const startup = window.setTimeout(() => { void refresh(); }, 0);
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearTimeout(startup);
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);
  return { asset: current.slug === slug ? current.asset : initial, refresh };
}
