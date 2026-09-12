import type { ProductArAsset } from "@/types";
import storedModels from "./product-ar-storage.json";

const assets: Record<string, ProductArAsset> = {
  "100010-9ce68e": {
    cameraOrbit: "-35deg 75deg auto",
    photoUrl: "/models/x-desk-210027/original.webp",
    ...storedModels["100010-9ce68e"],
    alt: "Kompjuter sto X DESK — svetli hrast i crna X konstrukcija, 3D prikaz",
    dimensionsCm: { w: 70, d: 48, h: 74 },
  },
};

export function getProductArAsset(slug: string): ProductArAsset | undefined {
  return Object.hasOwn(assets, slug) ? assets[slug] : undefined;
}

export function arPlatform(userAgent: string, maxTouchPoints = 0): "ios" | "android" | "desktop" {
  if (/iPad|iPhone|iPod/i.test(userAgent) || (/Macintosh/i.test(userAgent) && maxTouchPoints > 1)) return "ios";
  return /Android/i.test(userAgent) ? "android" : "desktop";
}

/** Same-origin links also work through the temporary local HTTPS tunnel. */
export function productArShareUrl(pageUrl: string, previewOrigin?: string): string {
  let url = new URL(pageUrl);
  if (["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) && previewOrigin) {
    try {
      const preview = new URL(previewOrigin);
      if (preview.protocol === "https:") url = new URL(url.pathname, preview.origin);
    } catch { /* Keep the local URL when the optional preview origin is invalid. */ }
  }
  url.search = "";
  url.hash = "";
  url.pathname = url.pathname.replace(/^\/p\//, "/ar/");
  return url.toString();
}

/** Direct native launch; fallback never automatically relaunches a rejected intent. */
export function androidArIntent(asset: ProductArAsset, launchUrl: string): string {
  const origin = new URL(launchUrl).origin;
  const fallback = new URL(launchUrl);
  fallback.search = "?manual=1&arFallback=1";
  const query = new URLSearchParams({
    file: new URL(asset.glbUrl, origin).href,
    mode: "ar_only", resizable: "false",
  });
  return `intent://arvr.google.com/scene-viewer/1.0?${query}#Intent;scheme=https;package=com.google.ar.core;action=android.intent.action.VIEW;S.browser_fallback_url=${encodeURIComponent(fallback.href)};end;`;
}

/** Escape an in-app QR browser, then require a fresh tap for the camera launch. */
export function androidChromeArIntent(launchUrl: string): string {
  const url = new URL(productArShareUrl(launchUrl));
  url.search = "?manual=1";
  return `intent://${url.host}${url.pathname}${url.search}#Intent;scheme=${url.protocol.slice(0, -1)};package=com.android.chrome;action=android.intent.action.VIEW;S.browser_fallback_url=${encodeURIComponent(url.href)};end;`;
}
