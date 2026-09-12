"use client";

import dynamic from "next/dynamic";
import { useRef, useState, useSyncExternalStore } from "react";
import { Box, Smartphone } from "lucide-react";
import { androidArIntent, arPlatform, productArShareUrl } from "@/lib/product-ar";
import type { ProductArAsset } from "@/types";

const ArQrDialog = dynamic(() => import("./product-ar-qr-dialog"), {
  ssr: false,
  loading: () => <span role="status" className="rounded bg-white p-2 text-xs">Priprema QR koda…</span>,
});

const subscribeHydration = () => () => {};
const clientHydrated = () => true;
const serverHydrated = () => false;

/** Lightweight photo controls. No viewer, model, or QR encoder loads on entry. */
export function ProductArEntryControls({ asset, onView3d }: { asset: ProductArAsset; onView3d: () => void }) {
  // A native AR launch needs a live click handler; early SSR clicks must not disappear.
  const hydrated = useSyncExternalStore(subscribeHydration, clientHydrated, serverHydrated);
  const trigger = useRef<HTMLButtonElement>(null);
  const [qrUrl, setQrUrl] = useState("");
  const [message, setMessage] = useState("");
  function launch() {
    const platform = arPlatform(navigator.userAgent, navigator.maxTouchPoints);
    const url = productArShareUrl(location.href, process.env.NEXT_PUBLIC_AR_PREVIEW_ORIGIN);
    setMessage("");
    if (platform === "desktop") { setQrUrl(url); return; }
    const anchor = document.createElement("a");
    if (platform === "ios") {
      if (!anchor.relList.supports("ar")) {
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
    anchor.click();
    anchor.remove();
  }
  return <div data-product-ar-entry className="absolute inset-x-3 bottom-10 z-20 flex flex-col items-center gap-2">
    <span className="rounded-full bg-white/95 px-3 py-1 text-[11px] font-medium text-ink-600">Proverite kako se uklapa u vaš prostor</span>
    <div className="flex max-w-full items-center gap-2 rounded-full bg-white/95 p-1.5 shadow-lg ring-1 ring-border/70">
      <button ref={trigger} type="button" onClick={launch} disabled={!hydrated} aria-haspopup="dialog"
        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-ink-900 px-3 text-[13px] font-semibold text-white transition hover:bg-ink-700 focus-visible:outline-2 focus-visible:outline-offset-2">
        <Smartphone className="size-4 shrink-0" aria-hidden />Pogledaj u svojoj sobi
      </button>
      <button type="button" onClick={onView3d} disabled={!hydrated} aria-label="Otvori 3D pregled"
        className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold text-ink-800 transition hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2">
        <Box className="size-4" aria-hidden />3D
      </button>
    </div>
    {message && <p role="status" className="max-w-sm rounded-xl bg-white p-3 text-center text-xs shadow-sm">{message}</p>}
    {qrUrl && <ArQrDialog url={qrUrl} onClose={() => setQrUrl("")} trigger={trigger} />}
  </div>;
}
