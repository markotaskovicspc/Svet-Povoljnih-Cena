"use client";

/**
 * PDP gallery — main image with magnify-on-hover + click-to-lightbox,
 * vertical thumb strip on the right, plus virtual "video" and "3D" thumbs
 * that swap the main view to a video player or a 3D viewer placeholder.
 *
 * Media is sourced from the product catalog import; the cloud service can
 * supply images / video / 3D bundles by SKU pattern.
 */
import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Box,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Play,
  X,
} from "lucide-react";
import type { MediaAsset, Product } from "@/types";
import { cn } from "@/lib/utils";

const FALLBACK_BLUR =
  "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA4IDEwIj48cmVjdCB3aWR0aD0iOCIgaGVpZ2h0PSIxMCIgZmlsbD0iI2YxZWNlMyIvPjwvc3ZnPg==";

type Slide =
  | { kind: "image"; asset: MediaAsset }
  | { kind: "video"; asset: MediaAsset }
  | { kind: "3d"; asset: MediaAsset };

interface PdpGalleryProps {
  product: Product;
  /** Slot for stacked badges rendered above the main media. */
  badges?: React.ReactNode;
}

export function PdpGallery({ product, badges }: PdpGalleryProps) {
  const slides = useMemo<Slide[]>(() => {
    const out: Slide[] = product.media.images.map((asset) => ({
      kind: "image" as const,
      asset,
    }));
    if (product.media.video) out.push({ kind: "video", asset: product.media.video });
    if (product.media.video3d) out.push({ kind: "3d", asset: product.media.video3d });
    return out;
  }, [product.media]);

  const [active, setActive] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const mobileTrackRef = useRef<HTMLDivElement | null>(null);
  const desktopTrackRef = useRef<HTMLDivElement | null>(null);
  const thumbTrackRef = useRef<HTMLUListElement | null>(null);
  const [thumbOverflow, setThumbOverflow] = useState({ up: false, down: false });

  const slide = slides[active] ?? slides[0];

  const goTo = useCallback(
    (index: number) => {
      if (!slides.length) return;
      const nextIndex = ((index % slides.length) + slides.length) % slides.length;
      setActive(nextIndex);
      [mobileTrackRef.current, desktopTrackRef.current].forEach((track) => {
        track
          ?.querySelector<HTMLElement>(`[data-slide-index="${nextIndex}"]`)
          ?.scrollIntoView({
            behavior: "smooth",
            inline: "center",
            block: "nearest",
          });
      });
    },
    [slides.length],
  );

  const updateThumbOverflow = useCallback(() => {
    const el = thumbTrackRef.current;
    if (!el) return;
    const maxScroll = el.scrollHeight - el.clientHeight;
    setThumbOverflow({
      up: el.scrollTop > 2,
      down: maxScroll > 2 && el.scrollTop < maxScroll - 2,
    });
  }, []);

  useEffect(() => {
    updateThumbOverflow();
    window.addEventListener("resize", updateThumbOverflow);
    return () => window.removeEventListener("resize", updateThumbOverflow);
  }, [slides.length, updateThumbOverflow]);

  function scrollThumbs(direction: 1 | -1) {
    thumbTrackRef.current?.scrollBy({
      top: direction * 96,
      behavior: "smooth",
    });
  }

  const syncTrackActive = useCallback((track: HTMLDivElement | null) => {
    if (!track) return;
    const index = Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
    setActive(Math.max(0, Math.min(index, slides.length - 1)));
  }, [slides.length]);

  if (!slide) return null;

  return (
    <div className="flex flex-col gap-4 md:flex-row-reverse md:gap-6">
      {/* Main stage */}
      <div className="relative flex-1">
        <div className="relative md:hidden">
          <div
            ref={mobileTrackRef}
            onScroll={() => syncTrackActive(mobileTrackRef.current)}
            className="flex touch-pan-x snap-x snap-mandatory overflow-x-auto overscroll-x-contain rounded-lg bg-white ring-1 ring-border/60 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            aria-label="Galerija proizvoda"
            aria-roledescription="carousel"
          >
            {slides.map((s, index) => (
              <div
                key={`${s.kind}-mobile-${index}`}
                data-slide-index={index}
                className="relative aspect-square min-w-full snap-center"
              >
                {s.kind === "image" ? (
                  <Image
                    src={s.asset.url}
                    alt={s.asset.alt ?? product.name}
                    fill
                    priority={index === 0}
                    sizes="100vw"
                    placeholder="blur"
                    blurDataURL={s.asset.blurDataUrl ?? FALLBACK_BLUR}
                    className="object-contain p-3"
                  />
                ) : s.kind === "video" ? (
                  <video
                    src={s.asset.url}
                    controls
                    playsInline
                    className="h-full w-full object-cover"
                    poster={product.media.images[0]?.url}
                  />
                ) : (
                  <iframe
                    title={`3D pregled — ${product.name}`}
                    src={s.asset.url}
                    className="h-full w-full border-0"
                    allow="accelerometer; gyroscope; xr-spatial-tracking"
                  />
                )}
              </div>
            ))}
          </div>
          {badges ? (
            <div className="pointer-events-none absolute top-0 left-0 flex max-w-[70%] flex-col items-start gap-1">
              {badges}
            </div>
          ) : null}
          {slides.length > 1 ? (
            <div className="mt-3 flex justify-center gap-1.5">
              {slides.map((_, index) => (
                <button
                  key={index}
                  type="button"
                  onClick={() => goTo(index)}
                  aria-label={`Prikaži sliku ${index + 1}`}
                  aria-current={index === active ? "true" : undefined}
                  className={cn(
                    "h-1.5 rounded-full transition-all",
                    index === active ? "w-8 bg-ink-900" : "w-3 bg-ink-200",
                  )}
                />
              ))}
            </div>
          ) : null}
        </div>
        <div className="relative hidden md:block">
          <div
            ref={desktopTrackRef}
            onScroll={() => syncTrackActive(desktopTrackRef.current)}
            className="bg-white ring-border/60 flex h-[min(65vh,620px)] min-h-[360px] w-full snap-x snap-mandatory overflow-x-auto rounded-lg ring-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            aria-label="Galerija proizvoda"
            aria-roledescription="carousel"
          >
            {slides.map((s, index) => (
              <div
                key={`${s.kind}-desktop-${index}`}
                data-slide-index={index}
                onClick={() => {
                  setActive(index);
                  if (s.kind === "image") setLightboxOpen(true);
                }}
                className={cn(
                  "relative min-w-full snap-center",
                  s.kind === "image" ? "cursor-pointer" : "cursor-default",
                )}
                role={s.kind === "image" ? "button" : undefined}
                aria-label={s.kind === "image" ? "Otvori sliku" : undefined}
              >
                {s.kind === "image" ? (
                  <>
                    <motion.div
                      layoutId={
                        index === 0 && active === 0
                          ? `product-cover-${product.sku}`
                          : undefined
                      }
                      className="absolute inset-0"
                      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                    >
                      <Image
                        src={s.asset.url}
                        alt={s.asset.alt ?? product.name}
                        fill
                        priority={index === 0}
                        sizes="(min-width: 1024px) 50vw, 100vw"
                        placeholder="blur"
                        blurDataURL={s.asset.blurDataUrl ?? FALLBACK_BLUR}
                        className="object-contain p-4"
                      />
                    </motion.div>
                  </>
                ) : s.kind === "video" ? (
                  <div className="grid h-full w-full place-items-center">
                    <video
                      src={s.asset.url}
                      controls
                      playsInline
                      className="h-full w-full object-cover"
                      poster={product.media.images[0]?.url}
                    />
                  </div>
                ) : (
                  <div className="bg-canvas grid h-full w-full place-items-center">
                    <iframe
                      title={`3D pregled — ${product.name}`}
                      src={s.asset.url}
                      className="h-full w-full border-0"
                      allow="accelerometer; gyroscope; xr-spatial-tracking"
                    />
                  </div>
                )}
              </div>
            ))}
          </div>

          {badges ? (
            <div className="pointer-events-none absolute top-0 left-0 flex max-w-[70%] flex-col items-start gap-1">
              {badges}
            </div>
          ) : null}
          {slides.length > 1 ? (
            <>
              <button
                type="button"
                onClick={() => goTo(active - 1)}
                aria-label="Prethodna slika"
                className="absolute top-1/2 left-3 inline-flex size-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/85 text-ink-800 ring-1 ring-border/60 backdrop-blur transition hover:bg-white"
              >
                <ChevronLeft className="size-5" aria-hidden />
              </button>
              <button
                type="button"
                onClick={() => goTo(active + 1)}
                aria-label="Sledeća slika"
                className="absolute top-1/2 right-3 inline-flex size-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/85 text-ink-800 ring-1 ring-border/60 backdrop-blur transition hover:bg-white"
              >
                <ChevronRight className="size-5" aria-hidden />
              </button>
              <div className="absolute inset-x-0 bottom-4 flex justify-center gap-1.5">
                {slides.map((_, index) => (
                  <button
                    key={index}
                    type="button"
                    onClick={() => goTo(index)}
                    aria-label={`Prikaži sliku ${index + 1}`}
                    aria-current={index === active ? "true" : undefined}
                    className={cn(
                      "h-1.5 rounded-full transition-all",
                      index === active
                        ? "w-8 bg-ink-900"
                        : "w-3 bg-white/80 ring-1 ring-border/60",
                    )}
                  />
                ))}
              </div>
            </>
          ) : null}
        </div>
      </div>

      {/* Thumb strip */}
      <div className="relative hidden md:block">
        {thumbOverflow.up ? (
          <button
            type="button"
            onClick={() => scrollThumbs(-1)}
            aria-label="Pomeri sličice nagore"
            className="absolute inset-x-0 -top-3 z-10 mx-auto inline-flex size-8 items-center justify-center rounded-full bg-white text-ink-700 shadow-soft-2 ring-1 ring-border/60 transition hover:text-walnut"
          >
            <ChevronUp className="size-4" aria-hidden />
          </button>
        ) : null}
        <ul
          ref={thumbTrackRef}
          onScroll={updateThumbOverflow}
          className="flex max-h-[min(72vh,680px)] flex-col gap-2 overflow-y-auto pr-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          role="tablist"
          aria-label="Galerija proizvoda"
        >
          {slides.map((s, i) => {
            const isActive = i === active;
            const label =
              s.kind === "image"
                ? `Slika ${i + 1}`
                : s.kind === "video"
                  ? "Video"
                  : "3D pregled";
            return (
              <li key={`${s.kind}-${i}`} className="shrink-0">
                <button
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  aria-label={label}
                  onMouseEnter={() => goTo(i)}
                  onFocus={() => goTo(i)}
                  onClick={() => goTo(i)}
                  className={cn(
                    "bg-white ring-border/60 focus-visible:ring-walnut/40 relative grid size-16 place-items-center overflow-hidden rounded-xl ring-1 transition focus-visible:ring-2 focus-visible:outline-none md:size-20",
                    isActive && "ring-walnut ring-2",
                  )}
                >
                  {s.kind === "image" ? (
                    <Image
                      src={s.asset.url}
                      alt=""
                      fill
                      sizes="80px"
                      className="object-contain p-1"
                    />
                  ) : s.kind === "video" ? (
                    <Play className="size-5 text-ink-700" aria-hidden />
                  ) : (
                    <Box className="size-5 text-ink-700" aria-hidden />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
        {thumbOverflow.down ? (
          <button
            type="button"
            onClick={() => scrollThumbs(1)}
            aria-label="Pomeri sličice nadole"
            className="absolute inset-x-0 -bottom-3 z-10 mx-auto inline-flex size-8 items-center justify-center rounded-full bg-white text-ink-700 shadow-soft-2 ring-1 ring-border/60 transition hover:text-walnut"
          >
            <ChevronDown className="size-4" aria-hidden />
          </button>
        ) : null}
      </div>

      {/* Lightbox */}
      <AnimatePresence>
        {lightboxOpen && slide.kind === "image" ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="bg-ink-900/90 fixed inset-0 z-50 grid place-items-center p-4"
            role="dialog"
            aria-modal="true"
            aria-label={`${product.name} — uvećana slika`}
            onClick={() => setLightboxOpen(false)}
          >
            <button
              type="button"
              aria-label="Zatvori"
              onClick={() => setLightboxOpen(false)}
              className="bg-surface/10 hover:bg-surface/20 focus-visible:ring-canvas/60 absolute top-4 right-4 inline-flex size-10 items-center justify-center rounded-full text-canvas focus-visible:ring-2 focus-visible:outline-none"
            >
              <X className="size-5" aria-hidden />
            </button>
            <motion.div
              initial={{ scale: 0.96 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.96 }}
              transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
              className="relative aspect-[4/5] w-full max-w-[min(90vw,720px)]"
              onClick={(e) => e.stopPropagation()}
            >
              <Image
                src={slide.asset.url}
                alt={slide.asset.alt ?? product.name}
                fill
                sizes="90vw"
                className="object-contain"
              />
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
