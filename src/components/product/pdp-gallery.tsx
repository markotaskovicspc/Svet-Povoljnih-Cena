"use client";

/**
 * PDP gallery — main image with magnify-on-hover + click-to-lightbox,
 * vertical thumb strip on the right, plus virtual "video" and "3D" thumbs
 * that swap the main view to a video player or a 3D viewer placeholder.
 *
 * Phase 1: media is sourced from the product mock; in Phase 4 the cloud
 * service supplies images / video / 3D bundles by SKU pattern.
 */
import Image from "next/image";
import { useCallback, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Box, Play, X, ZoomIn } from "lucide-react";
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
  const reduced = useReducedMotion();

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
  const [zoom, setZoom] = useState({ on: false, x: 50, y: 50 });
  const stageRef = useRef<HTMLDivElement | null>(null);

  const slide = slides[active] ?? slides[0];

  const handleMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (slide?.kind !== "image") return;
      const rect = e.currentTarget.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 100;
      const y = ((e.clientY - rect.top) / rect.height) * 100;
      setZoom({ on: true, x, y });
    },
    [slide?.kind],
  );

  if (!slide) return null;

  return (
    <div className="flex flex-col gap-4 md:flex-row-reverse md:gap-6">
      {/* Main stage */}
      <div className="relative flex-1">
        <div
          ref={stageRef}
          onMouseMove={handleMove}
          onMouseLeave={() => setZoom((z) => ({ ...z, on: false }))}
          onClick={() => slide.kind === "image" && setLightboxOpen(true)}
          className={cn(
            "bg-muted-bg ring-border/60 relative aspect-[4/5] w-full overflow-hidden rounded-2xl ring-1",
            slide.kind === "image" ? "cursor-zoom-in" : "cursor-default",
          )}
          role={slide.kind === "image" ? "button" : undefined}
          aria-label={slide.kind === "image" ? "Uvećaj sliku" : undefined}
        >
          {slide.kind === "image" ? (
            <>
              <motion.div
                layoutId={
                  active === 0
                    ? `product-cover-${product.sku}`
                    : undefined
                }
                className="absolute inset-0"
                transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
              >
                <Image
                  src={slide.asset.url}
                  alt={slide.asset.alt ?? product.name}
                  fill
                  priority
                  sizes="(min-width: 1024px) 50vw, 100vw"
                  placeholder="blur"
                  blurDataURL={slide.asset.blurDataUrl ?? FALLBACK_BLUR}
                  className="object-cover"
                  style={
                    zoom.on && !reduced
                      ? {
                          transformOrigin: `${zoom.x}% ${zoom.y}%`,
                          transform: "scale(1.6)",
                          transition: "transform 120ms ease-out",
                        }
                      : { transition: "transform 200ms ease-out" }
                  }
                />
              </motion.div>
              <span className="bg-surface/85 text-ink-700 ring-border/60 absolute right-3 bottom-3 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] ring-1 backdrop-blur">
                <ZoomIn className="size-3.5" aria-hidden /> Uvećaj
              </span>
            </>
          ) : slide.kind === "video" ? (
            <div className="grid h-full w-full place-items-center">
              <video
                src={slide.asset.url}
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
                src={slide.asset.url}
                className="h-full w-full border-0"
                allow="accelerometer; gyroscope; xr-spatial-tracking"
              />
            </div>
          )}

          {/* Soft floor gradient (matches card aesthetic) */}
          {slide.kind === "image" ? (
            <div
              aria-hidden
              className="from-ink-900/12 pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t to-transparent"
            />
          ) : null}

          {badges ? (
            <div className="pointer-events-none absolute top-3 left-3 flex max-w-[70%] flex-col items-start gap-1">
              {badges}
            </div>
          ) : null}
        </div>
      </div>

      {/* Thumb strip */}
      <ul
        className="flex gap-2 overflow-x-auto md:flex-col md:overflow-visible"
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
                onClick={() => setActive(i)}
                className={cn(
                  "bg-muted-bg ring-border/60 focus-visible:ring-walnut/40 relative grid size-16 place-items-center overflow-hidden rounded-xl ring-1 transition focus-visible:ring-2 focus-visible:outline-none md:size-20",
                  isActive && "ring-walnut ring-2",
                )}
              >
                {s.kind === "image" ? (
                  <Image
                    src={s.asset.url}
                    alt=""
                    fill
                    sizes="80px"
                    className="object-cover"
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
