"use client";

/** Locally served, pre-minified runtime, shared by gallery and fullscreen. */
let runtime: Promise<void> | undefined;
let retries = 0;
const activated = new Set<string>();
const failedWarmups = new Set<string>();
const readyWarmups = new Set<string>();
let cancelWarmViewer: (() => void) | undefined;
export function loadProductArRuntime(): Promise<void> {
  if (customElements.get("model-viewer")) return Promise.resolve();
  if (runtime) return runtime;
  runtime = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.type = "module";
    // A failed ES module URL is remembered by the browser's module map.
    script.src = `/vendor/model-viewer/4.2.0/model-viewer.min.js${retries ? `?retry=${retries}` : ""}`;
    const finish = (error?: Error) => {
      clearTimeout(timer);
      script.onload = script.onerror = null;
      if (error) { script.remove(); reject(error); } else resolve();
    };
    const timer = window.setTimeout(() => finish(new Error("3D runtime timed out")), 30000);
    script.onload = () => finish(customElements.get("model-viewer") ? undefined : new Error("3D runtime unavailable"));
    script.onerror = () => finish(new Error("3D runtime failed to load"));
    document.head.appendChild(script);
  }).catch((error) => { runtime = undefined; retries += 1; throw error; });
  return runtime;
}

/** Called only on 3D activation: download model alongside runtime/UI chunks. */
export function prepareProductAr(glbUrl: string) {
  activated.add(glbUrl);
  cancelWarmViewer?.();
  if (!readyWarmups.has(glbUrl) && !Array.from(document.querySelectorAll<HTMLLinkElement>('link[data-ar-preload]')).some(link => link.getAttribute("href") === glbUrl)) {
    const link = document.createElement("link");
    link.rel = "preload";
    link.as = "fetch";
    link.crossOrigin = "anonymous";
    link.href = glbUrl;
    link.dataset.arPreload = "true";
    document.head.appendChild(link);
  }
  // ViewerSurface presents retry/fallback if this shared promise rejects.
  void loadProductArRuntime().catch(() => {});
}

export function productArModelUrl(glbUrl: string) {
  return failedWarmups.has(glbUrl) ? `${glbUrl}#after-warmup-failure` : glbUrl;
}

/** Decode and prepare shaders after the photo is ready, never on constrained links. */
export function scheduleProductArWarmup(gallery: HTMLElement, glbUrl: string) {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  if (connection?.saveData || /(^|-)2g|3g/.test(connection?.effectiveType || "") || (memory && memory <= 2)) return () => {};
  let disposed = false, scheduled = false, inView = false;
  let delay: number | undefined;
  let idle: number | undefined;
  const start = async () => {
    if (disposed || activated.has(glbUrl)) return;
    if (document.visibilityState !== "visible" || !inView) { scheduled = false; return; }
    // Load the UI chunk while the runtime is being prepared too.
    void import("@/components/product/product-ar-viewer").catch(() => {});
    try {
      await loadProductArRuntime();
      if (disposed || activated.has(glbUrl)) return;
      if (document.visibilityState !== "visible" || !inView) { scheduled = false; return; }
      const warm = document.createElement("model-viewer");
      warm.dataset.arWarmup = "true";
      warm.setAttribute("aria-hidden", "true");
      warm.inert = true;
      warm.style.cssText = "position:fixed;left:0;top:0;width:64px;height:64px;opacity:0;pointer-events:none;z-index:-1";
      for (const [key, value] of Object.entries({ loading: "eager", reveal: "auto", "shadow-intensity": "1", "shadow-softness": "1", "tone-mapping": "neutral", "camera-orbit": "35deg 65deg auto" })) warm.setAttribute(key, value);
      const cleanup = () => { clearTimeout(timeout); warm.remove(); if (cancelWarmViewer === cleanup) cancelWarmViewer = undefined; };
      cancelWarmViewer = cleanup;
      const timeout = window.setTimeout(() => { failedWarmups.add(glbUrl); cleanup(); }, 30000);
      warm.addEventListener("load", () => {
        readyWarmups.add(glbUrl);
        gallery.dataset.arWarmReady = glbUrl;
        cleanup();
      }, { once: true });
      warm.addEventListener("error", () => { failedWarmups.add(glbUrl); cleanup(); }, { once: true });
      warm.setAttribute("src", glbUrl);
      document.body.appendChild(warm);
    } catch { /* A speculative failure must never interrupt the product page. */ }
  };
  const check = () => {
    if (disposed || scheduled || !inView || document.visibilityState !== "visible" || document.readyState !== "complete") return;
    const photo = Array.from(gallery.querySelectorAll("img")).find(img => img.getBoundingClientRect().width > 100);
    if (!photo?.complete || !photo.naturalWidth) return;
    scheduled = true;
    delay = window.setTimeout(() => {
      if ("requestIdleCallback" in window) idle = window.requestIdleCallback(() => void start(), { timeout: 2000 });
      else void start();
    }, 800);
  };
  const observer = new IntersectionObserver(([entry]) => { inView = entry.isIntersecting; check(); });
  observer.observe(gallery);
  window.addEventListener("load", check);
  gallery.addEventListener("load", check, true);
  document.addEventListener("visibilitychange", check);
  return () => {
    disposed = true; clearTimeout(delay);
    if (idle !== undefined) window.cancelIdleCallback(idle);
    observer.disconnect(); window.removeEventListener("load", check);
    gallery.removeEventListener("load", check, true); document.removeEventListener("visibilitychange", check);
    cancelWarmViewer?.();
  };
}
