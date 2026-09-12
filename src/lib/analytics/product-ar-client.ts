"use client";
import { useEffect, useRef, useState } from "react";
import { getConsentedAnalyticsContext, recordFirstPartyEvent } from "@/components/analytics/first-party-analytics";
import { arPlatform, productArShareUrl } from "@/lib/product-ar";
import { AR_EXPERIMENT, type ProductArEvent, type ProductArMetadata } from "./product-ar-events";

import { countProductAr } from "./product-ar-counter-client";
import { captureCampaign } from "./campaign-attribution";

const sent = new Set<string>();
const COPY_KEY = `spc:${AR_EXPERIMENT}`;
const singleton = new Set<ProductArEvent>(["controls_viewed", "model_opened", "model_used", "ar_qr_landed"]);

export function arVariant(): "A" | "B" {
  if (typeof window === "undefined" || !getConsentedAnalyticsContext()) return "A";
  try {
    const inherited = new URLSearchParams(location.search).get("ar_variant");
    if (new URLSearchParams(location.search).get("ar_entry") === "qr" && (inherited === "A" || inherited === "B")) return inherited;
    const saved = localStorage.getItem(COPY_KEY);
    if (saved === "A" || saved === "B") return saved;
    const variant = crypto.getRandomValues(new Uint32Array(1))[0] % 2 ? "B" : "A";
    localStorage.setItem(COPY_KEY, variant);
    return variant;
  } catch { return "A"; }
}


export function trackProductAr(slug: string, event: ProductArEvent, surface: ProductArMetadata["surface"]) {
  try {
    countProductAr(slug, event);
    const context = getConsentedAnalyticsContext();
    if (!context) return false;
    const variant = arVariant();
    const key = `${context.sessionId}:${slug}:${event}:${event === "controls_viewed" ? surface : ""}`;
    if (singleton.has(event) && sent.has(key)) return false;
    const accepted = recordFirstPartyEvent({ type: "PRODUCT_AR", metadata: {
      event, eventId: crypto.randomUUID(), slug, experiment: AR_EXPERIMENT, variant,
      device: arPlatform(navigator.userAgent, navigator.maxTouchPoints), surface, ...captureCampaign(),
    } });
    if (accepted && singleton.has(event)) sent.add(key);
    return accepted;
  } catch {
    // Analytics must never prevent rotation, gallery navigation, or native AR.
    return false;
  }
}

export function useArExposure(slug: string, surface: "photo" | "ar_cta") {
  const ref = useRef<HTMLDivElement>(null);
  const [variant, setVariant] = useState<"A" | "B">("A");
  useEffect(() => {
    let visible = false;
    const check = () => {
      setVariant(arVariant());
      if (visible && document.visibilityState === "visible") trackProductAr(slug, "controls_viewed", surface);
    };
    const observer = new IntersectionObserver(entries => { visible = entries[0]?.isIntersecting === true && entries[0].intersectionRatio >= .5; check(); }, { threshold: [.5] });
    if (ref.current) observer.observe(ref.current);
    check();
    window.addEventListener("spc-cookie-consent", check);
    document.addEventListener("visibilitychange", check);
    return () => { observer.disconnect(); window.removeEventListener("spc-cookie-consent", check); document.removeEventListener("visibilitychange", check); };
  }, [slug, surface]);
  return { ref, variant };
}

export function arQrShareUrl(pageUrl: string) {
  const url = new URL(productArShareUrl(pageUrl, process.env.NEXT_PUBLIC_AR_PREVIEW_ORIGIN));
  url.searchParams.set("ar_entry", "qr");
  if (getConsentedAnalyticsContext()) {
    url.searchParams.set("ar_variant", arVariant());
    const attribution = captureCampaign();
    for (const key of ["source", "medium", "campaign", "content"] as const) if (attribution[key]) url.searchParams.set(`utm_${key}`, attribution[key]);
  }
  return url.href;
}
