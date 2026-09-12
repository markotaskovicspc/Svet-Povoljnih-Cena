"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ModelViewerElement } from "@google/model-viewer";
import { Box, Maximize2, RotateCw, Smartphone } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { QrCode } from "./ar-qr-code";
import { androidArIntent, arPlatform, productArShareUrl } from "@/lib/product-ar";
import type { ProductArAsset } from "@/types";
import { loadProductArRuntime, productArModelUrl } from "@/lib/product-ar-loader";

interface Props { asset: ProductArAsset; fallbackUrl?: string }
const buttonClass = "inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-ink-900 px-5 py-2.5 text-sm font-semibold text-white shadow-md transition hover:bg-ink-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-walnut disabled:opacity-50";

export default function ProductArViewer(props: Props) {
  const [expanded, setExpanded] = useState(false);
  return <>
    {!expanded && <ViewerSurface key={props.asset.glbUrl} {...props} onExpand={() => setExpanded(true)} />}
    <Dialog open={expanded} onOpenChange={setExpanded}>
      <DialogContent
        className="inset-0 h-dvh max-h-dvh w-screen max-w-none translate-x-0 translate-y-0 gap-0 overflow-hidden rounded-none p-0 sm:max-w-none"
        closeLabel="Zatvori prikaz preko celog ekrana"
        closeButtonClassName="top-3 right-3 z-20 size-11 rounded-full bg-white shadow-sm"
        finalFocus={() => document.querySelector<HTMLButtonElement>('[data-ar-expand]')}
      >
        <DialogTitle className="sr-only">3D prikaz preko celog ekrana</DialogTitle>
        <DialogDescription className="sr-only">Rotirajte i približite model. Zatvorite prikaz dugmetom ili tasterom Escape.</DialogDescription>
        {expanded && <ViewerSurface key={props.asset.glbUrl} {...props} />}
      </DialogContent>
    </Dialog>
  </>;
}

function ViewerSurface({ asset, fallbackUrl, onExpand }: Props & { onExpand?: () => void }) {
  const viewer = useRef<ModelViewerElement | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const [ready, setReady] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [progress, setProgress] = useState(0);
  const [qrOpen, setQrOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [message, setMessage] = useState("");
  const [platform] = useState(() => arPlatform(navigator.userAgent, navigator.maxTouchPoints));
  const [shareUrl] = useState(() => productArShareUrl(window.location.href, process.env.NEXT_PUBLIC_AR_PREVIEW_ORIGIN));
  const [arPrompt, setArPrompt] = useState(() => platform !== "desktop" && new URLSearchParams(window.location.search).get("ar") === "1");

  useEffect(() => {
    let cancelled = false;
    loadProductArRuntime().then(() => {
      if (!cancelled) setReady(true);
    }).catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [attempt]);

  useLayoutEffect(() => {
    const el = viewer.current;
    if (!ready || !el) return;
    const onLoad = () => { setLoaded(true); setProgress(100); };
    const onError = () => { setFailed(true); setLoaded(false); };
    const onProgress = (event: Event) => setProgress(Math.round((event as CustomEvent<{ totalProgress: number }>).detail.totalProgress * 100));
    const onArStatus = (event: Event) => {
      if ((event as CustomEvent<{ status: string }>).detail.status === "failed") setMessage("AR nije dostupan. Pokušajte u Safari pregledaču na iPhone-u ili Chrome-u na podržanom Android telefonu.");
    };
    el.addEventListener("load", onLoad);
    el.addEventListener("error", onError);
    el.addEventListener("progress", onProgress);
    el.addEventListener("ar-status", onArStatus);
    if (el.loaded) onLoad();
    const timeout = window.setTimeout(() => { if (!el.loaded) onError(); }, 45000);
    return () => {
      clearTimeout(timeout);
      el.removeEventListener("load", onLoad); el.removeEventListener("error", onError);
      el.removeEventListener("progress", onProgress); el.removeEventListener("ar-status", onArStatus);
    };
  }, [ready, attempt]);

  function launchAr() {
    setMessage("");
    if (platform === "desktop") { setCopied(false); setQrOpen(true); return; }
    if (platform === "android") {
      // The library uses ar_preferred and can silently fall back to native 3D.
      // Match the QR/photo entry: ARCore-only, with an explicit help page on failure.
      const anchor = document.createElement("a");
      anchor.href = androidArIntent(asset, shareUrl);
      anchor.hidden = true;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setArPrompt(false);
      return;
    }
    const el = viewer.current;
    if (!loaded || !el) return;
    if (!el.canActivateAR) {
      setMessage("Ovaj pregledač ne podržava AR. Otvorite stranicu u Safari-ju na iPhone-u ili Chrome-u na podržanom Android telefonu. 3D prikaz možete koristiti ovde.");
      return;
    }
    setArPrompt(false);
    // Keep activation inside the click gesture; never await a fetch first.
    try {
      void el.activateAR().catch(() => setMessage("AR nije pokrenut. Pokušajte ponovo ili otvorite stranicu u Safari/Chrome pregledaču."));
    } catch { setMessage("AR nije pokrenut. Pokušajte ponovo."); }
  }

  function retry() {
    setReady(false); setLoaded(false); setFailed(false); setProgress(0); setMessage("");
    setAttempt((value) => value + 1);
  }

  return (
    <div data-product-ar-viewer className="relative h-full w-full bg-white" style={{ touchAction: "pan-y" }}>
      {ready && !failed ? (
        <model-viewer
          key={attempt}
          ref={viewer}
          src={attempt ? `${asset.glbUrl}#retry-${attempt}` : productArModelUrl(asset.glbUrl)}
          ios-src={asset.usdzUrl}
          poster={asset.posterUrl}
          alt={asset.alt}
          ar
          ar-modes="scene-viewer quick-look"
          ar-placement="floor"
          ar-scale="fixed"
          camera-controls
          min-camera-orbit="auto 0deg auto"
          max-camera-orbit="auto 85deg auto"
          disable-pan
          touch-action="pan-y"
          interaction-prompt="none"
          camera-orbit={asset.cameraOrbit ?? "35deg 65deg auto"}
          field-of-view="30deg"
          shadow-intensity="1"
          shadow-softness="1"
          exposure="1"
          tone-mapping="neutral"
          loading="eager"
          reveal="auto"
          style={{ width: "100%", height: "calc(100% - 88px)" }}
        ><span slot="ar-button" hidden /></model-viewer>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- local poster and original photo fallback
        <img src={failed ? fallbackUrl || asset.posterUrl : asset.posterUrl} alt={asset.alt} className="w-full object-contain p-4" style={{ height: "calc(100% - 88px)" }} />
      )}
      {onExpand && <button type="button" data-ar-expand onClick={onExpand}
        className="absolute top-3 right-14 z-10 flex size-11 items-center justify-center rounded-full bg-white/95 shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2"
        aria-label="Prikaži 3D preko celog ekrana" title="Preko celog ekrana"><Maximize2 className="size-5" /></button>}
      <div className="pointer-events-none absolute top-3 left-3 flex items-center gap-1.5 rounded-full bg-white/90 px-3 py-1.5 text-xs text-ink-700 ring-1 ring-border/60">
        <Box className="size-3.5" /> 3D · {asset.dimensionsCm.w} × {asset.dimensionsCm.d} × {asset.dimensionsCm.h} cm
      </div>
      <div className="absolute inset-x-3 bottom-10 z-10 flex flex-col items-center gap-2 text-center md:bottom-12" data-ar-controls>
        {!loaded && !failed && <span role="status" className="rounded bg-white/90 px-3 py-1 text-xs">Učitavanje 3D modela… {progress}%</span>}
        {failed ? (
          <div className="rounded-xl bg-white/95 p-3 shadow-sm">
            <p role="alert" className="mb-2 text-sm">3D model trenutno nije dostupan. Fotografije možete pregledati u galeriji.</p>
            <button type="button" className={buttonClass} onClick={retry}><RotateCw className="size-4" /> Pokušaj ponovo</button>
          </div>
        ) : <>
          {loaded && <span className="pointer-events-none rounded bg-white/85 px-2 py-1 text-[11px] text-ink-600">Prevucite za rotaciju · približite za detalje</span>}
          {arPrompt && <span className="rounded bg-white/95 px-3 py-1 text-xs font-medium">Dodirnite dugme da postavite proizvod u sobu.</span>}
          <button ref={trigger} type="button" className={buttonClass} onClick={launchAr} disabled={!loaded && platform !== "desktop"}>
            <Smartphone className="size-4" /> Pogledaj u svojoj sobi
          </button>
        </>}
        {message && <p role="status" className="max-w-md rounded-xl bg-white/95 p-3 text-xs shadow-sm">{message}</p>}
      </div>
      <Dialog open={qrOpen} onOpenChange={setQrOpen}>
        <DialogContent className="text-center" finalFocus={trigger}>
          <DialogTitle className="pr-5 text-xl">Pogledaj u svojoj sobi</DialogTitle>
          <DialogDescription>Skenirajte QR kod kamerom telefona da otvorite AR. Ako telefon zatraži potvrdu, dodirnite „Pokreni AR”.</DialogDescription>
          {shareUrl && <div className="mx-auto rounded-xl bg-white p-3"><QrCode value={shareUrl} size={232} /></div>}
          <p className="text-xs text-ink-600">iPhone: Safari · Android: Chrome sa AR podrškom</p>
          <button type="button" className={buttonClass} onClick={() => {
            void navigator.clipboard.writeText(shareUrl).then(() => setCopied(true)).catch(() => setMessage("Kopiranje nije uspelo. Link možete otvoriti ispod."));
          }}>{copied ? "Link je kopiran" : "Kopiraj link"}</button>
          <a href={shareUrl} className="break-all text-xs text-ink-600 underline">{shareUrl}</a>
        </DialogContent>
      </Dialog>
    </div>
  );
}
