"use client";
import { useEffect, useRef, useState } from "react";
import { androidArIntent, androidChromeArIntent, arPlatform } from "@/lib/product-ar";
import type { ProductArAsset } from "@/types";

export default function ArLauncher({ asset, productPath }: { asset: ProductArAsset; productPath: string }) {
  const anchor = useRef<HTMLAnchorElement>(null);
  const attempted = useRef(false);
  const [device] = useState(() => {
    const platform = arPlatform(navigator.userAgent, navigator.maxTouchPoints);
    const supported = platform === "android" || (platform === "ios" && document.createElement("a").relList.supports("ar"));
    return { platform, supported, chromeHref: androidChromeArIntent(location.href), fallback: new URLSearchParams(location.search).get("arFallback") === "1", href: platform === "ios"
      ? `${new URL(asset.usdzUrl, location.origin).href}#allowsContentScaling=0`
      : androidArIntent(asset, location.href) };
  });
  useEffect(() => {
    if (attempted.current || !device.supported || new URLSearchParams(location.search).has("manual")) return;
    attempted.current = true;
    // A QR scanner may preserve activation. Browsers that reject this keep the
    // real native link available for a synchronous user tap; never loop/retry.
    anchor.current?.click();
  }, [device]);
  return <section className="mx-auto w-full max-w-sm text-center" aria-label="Pokretanje AR prikaza">
    <p className="mb-3 text-xs font-semibold tracking-widest text-ink-600">SVET POVOLJNIH CENA</p>
    <h1 className="text-2xl font-semibold">Fotelja u vašoj sobi</h1>
    {/* eslint-disable-next-line @next/next/no-img-element -- native Quick Look also requires an image in its anchor */}
    <img src={asset.posterUrl} alt={asset.alt} className="my-5 aspect-square w-full object-contain" />
    {device.supported ? <>
      {device.platform === "android" && device.fallback ? <div role="status" className="mb-5 rounded-xl bg-surface p-4 text-left text-sm text-ink-600">
        <p className="font-semibold text-ink-900">AR kamera nije pokrenuta.</p>
        <p className="mt-2">Otvorite ovaj link u Chrome-u i proverite da li su Google Play usluge za AR i Google aplikacija ažurirane. Telefon mora podržavati ARCore. Zatim ponovo dodirnite „Pokreni AR”.</p>
        <a className="mt-2 inline-block underline" href="https://play.google.com/store/apps/details?id=com.google.ar.core">Proveri Google Play usluge za AR</a>
      </div> : <p className="mb-5 text-sm text-ink-600">Ako se AR ne otvori automatski, dodirnite „Pokreni AR”. Kada telefon zatraži pristup kameri, dozvolite ga i usmerite kameru ka podu.</p>}
      <a ref={anchor} rel={device.platform === "ios" ? "ar" : undefined} href={device.href}
        className="flex min-h-14 items-center justify-center rounded-full bg-ink-900 px-6 font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-4">
        {/* eslint-disable-next-line @next/next/no-img-element -- required by Safari's AR link contract */}
        <img src={asset.posterUrl} alt="" className="sr-only" />Pokreni AR
      </a>
    </> : <p role="status" className="rounded-xl bg-surface p-4 text-sm">Otvorite ovaj link u Safari-ju na iPhone-u ili Chrome-u na Android telefonu sa AR podrškom.</p>}
    {device.platform === "android" && <p className="mt-4 text-sm text-ink-600">
      Skenirali ste preko Google Lens-a ili kamera nije otvorena?{" "}
      <a href={device.chromeHref} className="font-semibold underline">Otvori u Chrome-u</a>{" "}
      i dodirnite „Pokreni AR”.
    </p>}
    <p className="mt-4 text-xs text-ink-600">Stvarna veličina · {asset.dimensionsCm.w} × {asset.dimensionsCm.d} × {asset.dimensionsCm.h} cm</p>
    <a href={productPath} className="mt-6 inline-block text-sm underline">Nazad na proizvod i 3D prikaz</a>
  </section>;
}
