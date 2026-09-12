"use client";

import dynamic from "next/dynamic";
import { useRef, useState, useSyncExternalStore } from "react";
import { Box, Smartphone } from "lucide-react";
import { androidArIntent, arPlatform, productArShareUrl } from "@/lib/product-ar";
import { AR_COPY } from "@/lib/analytics/product-ar-events";
import { arQrShareUrl, trackProductAr, useArExposure } from "@/lib/analytics/product-ar-client";
import type { ProductArAsset } from "@/types";

const ArQrDialog = dynamic(() => import("./product-ar-qr-dialog"), {
  ssr: false,
  loading: () => <span role="status" className="rounded bg-white p-2 text-xs">Priprema QR koda…</span>,
});

const subscribeHydration = () => () => {};
const clientHydrated = () => true;
const serverHydrated = () => false;

/** Lightweight photo controls. No viewer, model, or QR encoder loads on entry. */
export function ProductArEntryControls({ asset, slug }: { asset: ProductArAsset; slug: string }) {
  const { ref, variant } = useArExposure(slug, "ar_cta");
  // A native AR launch needs a live click handler; early SSR clicks must not disappear.
  const hydrated = useSyncExternalStore(subscribeHydration, clientHydrated, serverHydrated);
  const trigger = useRef<HTMLButtonElement>(null);
  const [qrUrl, setQrUrl] = useState("");
  const [message, setMessage] = useState("");
  function launch() {
    const platform = arPlatform(navigator.userAgent, navigator.maxTouchPoints);
    const url = productArShareUrl(location.href, process.env.NEXT_PUBLIC_AR_PREVIEW_ORIGIN);
    setMessage("");
    trackProductAr(slug, "controls_viewed", "ar_cta");
    trackProductAr(slug, "ar_clicked", "ar_cta");
    if (platform === "desktop") { trackProductAr(slug, "ar_qr_opened", "ar_cta"); setQrUrl(arQrShareUrl(location.href)); return; }
    const anchor = document.createElement("a");
    if (platform === "ios") {
      if (!anchor.relList.supports("ar")) {
        trackProductAr(slug, "ar_failed", "ar_cta");
        setMessage("Za AR otvorite stranicu u Safari-ju. Ovde možete koristiti 3D pregled.");
        return;
      }
      anchor.rel = "ar";
      anchor.href = `${new URL(asset.usdzUrl, new URL(url).origin).href}#allowsContentScaling=0`;
      // Safari requires an image child. There is no asynchronous work before click.
      anchor.appendChild(document.createElement("img"));
    } else {
      anchor.href = androidArIntent(asset, url);
    }
    anchor.hidden = true;
    document.body.appendChild(anchor);
    trackProductAr(slug, "ar_attempted", "ar_cta");
    anchor.click();
    anchor.remove();
  }
  return <div ref={ref} data-product-ar-entry data-ar-variant={variant} className="mt-4 flex flex-col items-center gap-2 rounded-xl border border-border/60 bg-surface p-4 text-center">
    <button ref={trigger} type="button" onClick={launch} disabled={!hydrated}
      className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-ink-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-ink-700 focus-visible:outline-2 focus-visible:outline-offset-2">
      <Smartphone className="size-5 shrink-0" aria-hidden />{AR_COPY[variant]}
    </button>
    <p className="text-xs text-ink-600">Pomoću kamere telefona · na računaru skenirajte QR kod</p>
    {message && <p role="status" className="max-w-sm text-xs">{message}</p>}
    {qrUrl && <ArQrDialog url={qrUrl} onClose={() => setQrUrl("")} trigger={trigger} />}
  </div>;
}

export function ProductThreeDEntry({ slug, onView3d }: { slug: string; onView3d: () => void }) {
  const { ref } = useArExposure(slug, "photo");
  const hydrated = useSyncExternalStore(subscribeHydration, clientHydrated, serverHydrated);
  return <div ref={ref} data-product-3d-entry className="pointer-events-none absolute inset-x-3 bottom-10 z-20 flex justify-center">
    <button type="button" disabled={!hydrated} onClick={() => { trackProductAr(slug, "controls_viewed", "photo"); onView3d(); }}
      className="pointer-events-auto inline-flex min-h-12 items-center gap-2 rounded-full bg-white/95 px-5 py-3 text-sm font-semibold text-ink-900 shadow-md ring-1 ring-border/70 focus-visible:outline-2 focus-visible:outline-offset-2">
      <Box className="size-5" aria-hidden />Pogledaj iz svih uglova · 3D
    </button>
  </div>;
}
