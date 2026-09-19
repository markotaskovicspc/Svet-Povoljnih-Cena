import { getManagedProductMediaStorageKey } from "@/lib/supabase/storage";

export function isOptimizableIconKey(key: string) {
  return key.length <= 700 && !key.split("/").some((part) => part === "." || part === ".." || !part) &&
    /^(pictograms|mobile-shortcuts)\/[a-z0-9._/-]+\.(png|jpe?g|webp|avif)$/i.test(key);
}

/** Only public, immutable raster icons; private buckets and SVGs stay untouched. */
export function optimizedIconUrl(url: string) {
  if (/^https?:/.test(url)) {
    try { const parsed = new URL(url); if (parsed.search || !parsed.pathname.includes("/storage/v1/object/public/product-media/")) return url; } catch { return url; }
  }
  const key = getManagedProductMediaStorageKey(url);
  return key && isOptimizableIconKey(key) ? `/api/media/icon?key=${encodeURIComponent(key)}` : url;
}
