"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ModelViewerElement } from "@google/model-viewer";
import { ArrowLeft, Box, Maximize2, RotateCw } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { ProductArAsset } from "@/types";
import { loadProductArRuntime, productArModelUrl } from "@/lib/product-ar-loader";
import { trackProductAr } from "@/lib/analytics/product-ar-client";

interface Props { asset: ProductArAsset; slug: string; fallbackUrl?: string; onPhotos: () => void }
export default function ProductArViewer(props: Props) {
  const [expanded, setExpanded] = useState(false);
  return <>
    {!expanded && <ViewerSurface key={props.asset.glbUrl} {...props} onExpand={() => setExpanded(true)} />}
    <Dialog open={expanded} onOpenChange={setExpanded}>
      <DialogContent className="inset-0 h-dvh max-h-dvh w-screen max-w-none translate-x-0 translate-y-0 gap-0 overflow-hidden rounded-none p-0 sm:max-w-none"
        closeLabel="Zatvori prikaz preko celog ekrana" closeButtonClassName="top-3 right-3 z-20 size-11 rounded-full bg-white shadow-sm"
        finalFocus={() => document.querySelector<HTMLButtonElement>("[data-ar-expand]")}>
        <DialogTitle className="sr-only">3D prikaz preko celog ekrana</DialogTitle>
        <DialogDescription className="sr-only">Rotirajte i približite model. Zatvorite prikaz dugmetom ili tasterom Escape.</DialogDescription>
        {expanded && <ViewerSurface key={props.asset.glbUrl} {...props} />}
      </DialogContent>
    </Dialog>
  </>;
}

function ViewerSurface({ asset, slug, fallbackUrl, onPhotos, onExpand }: Props & { onExpand?: () => void }) {
  const viewer = useRef<ModelViewerElement | null>(null);
  const [ready, setReady] = useState(false), [loaded, setLoaded] = useState(false), [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0), [progress, setProgress] = useState(0);
  const surface = onExpand ? "viewer" : "fullscreen";
  useEffect(() => {
    let cancelled = false;
    trackProductAr(slug, "model_requested", surface);
    loadProductArRuntime().then(() => { if (!cancelled) setReady(true); }).catch(() => {
      if (!cancelled) { setFailed(true); trackProductAr(slug, "model_failed", surface); }
    });
    return () => { cancelled = true; };
  }, [attempt, slug, surface]);
  useLayoutEffect(() => {
    const el = viewer.current;
    if (!ready || !el) return;
    const onLoad = () => { setLoaded(true); setProgress(100); trackProductAr(slug, "model_opened", surface); };
    const onError = () => { setFailed(true); setLoaded(false); trackProductAr(slug, "model_failed", surface); };
    const onProgress = (event: Event) => setProgress(Math.round((event as CustomEvent<{ totalProgress: number }>).detail.totalProgress * 100));
    const onCamera = (event: Event) => { if ((event as CustomEvent<{ source: string }>).detail.source === "user-interaction") trackProductAr(slug, "model_used", surface); };
    const onConsent = () => { if (el.loaded) trackProductAr(slug, "model_opened", surface); };
    el.addEventListener("load", onLoad); el.addEventListener("error", onError); el.addEventListener("progress", onProgress); el.addEventListener("camera-change", onCamera);
    window.addEventListener("spc-cookie-consent", onConsent);
    if (el.loaded) onLoad();
    const timeout = window.setTimeout(() => { if (!el.loaded) onError(); }, 45000);
    return () => {
      clearTimeout(timeout); el.removeEventListener("load", onLoad); el.removeEventListener("error", onError); el.removeEventListener("progress", onProgress); el.removeEventListener("camera-change", onCamera);
      window.removeEventListener("spc-cookie-consent", onConsent);
    };
  }, [ready, attempt, slug, surface]);
  return <div data-product-ar-viewer className="relative h-full w-full bg-white" style={{ touchAction: "pan-y" }}>
    {ready && !failed ? <model-viewer key={attempt} ref={viewer} src={attempt ? `${asset.glbUrl}#retry-${attempt}` : productArModelUrl(asset.glbUrl)}
      poster={asset.posterUrl} alt={asset.alt} camera-controls min-camera-orbit="auto 0deg auto" max-camera-orbit="auto 85deg auto" disable-pan touch-action="pan-y"
      interaction-prompt="none" camera-orbit={asset.cameraOrbit ?? "35deg 65deg auto"} field-of-view="40deg" max-field-of-view="45deg"
      shadow-intensity="1" shadow-softness="1" exposure="1" tone-mapping="neutral" loading="eager" reveal="auto" style={{ width: "100%", height: "100%" }} /> :
      // eslint-disable-next-line @next/next/no-img-element -- local poster and original photo fallback
      <img src={failed ? fallbackUrl || asset.posterUrl : asset.posterUrl} alt={asset.alt} className="h-full w-full object-contain p-4" />}
    {onExpand && <>
      <button type="button" onClick={onPhotos} className="absolute top-3 left-3 z-10 inline-flex min-h-11 items-center gap-1 rounded-full bg-white/95 px-3 text-xs font-semibold shadow-sm focus-visible:outline-2"><ArrowLeft className="size-4" />Nazad na fotografije</button>
      <button type="button" data-ar-expand onClick={onExpand} className="absolute top-3 right-14 z-10 flex size-11 items-center justify-center rounded-full bg-white/95 shadow-sm focus-visible:outline-2"
        aria-label="Prikaži 3D preko celog ekrana"><Maximize2 className="size-5" /></button>
    </>}
    <div className={`pointer-events-none absolute left-3 ${onExpand ? "top-16" : "top-3"} flex items-center gap-1.5 rounded-full bg-white/90 px-3 py-1.5 text-xs text-ink-700 ring-1 ring-border/60`}>
      <Box className="size-3.5" />3D · {asset.dimensionsCm.w} × {asset.dimensionsCm.d} × {asset.dimensionsCm.h} cm
    </div>
    <div className="pointer-events-none absolute inset-x-3 bottom-10 z-10 flex flex-col items-center gap-2 text-center md:bottom-12" data-ar-controls>
      {!loaded && !failed && <span role="status" className="rounded bg-white/90 px-3 py-1 text-xs">Učitavanje 3D modela… {progress}%</span>}
      {failed ? <div className="rounded-xl bg-white/95 p-3 shadow-sm"><p role="alert" className="mb-2 text-sm">3D model trenutno nije dostupan. Fotografije možete pregledati u galeriji.</p>
        <button type="button" className="pointer-events-auto inline-flex min-h-11 items-center gap-2 rounded-full bg-ink-900 px-5 text-sm text-white" onClick={() => { setReady(false); setLoaded(false); setFailed(false); setProgress(0); setAttempt(value => value + 1); }}><RotateCw className="size-4" />Pokušaj ponovo</button>
      </div> : loaded && <span className="rounded bg-white/85 px-2 py-1 text-[11px] text-ink-600">Prevuci za rotaciju · približi za detalje</span>}
    </div>
  </div>;
}
