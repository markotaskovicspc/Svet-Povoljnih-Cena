"use client";

/**
 * Home hero banner carousel — Phase 1B.
 * Full-width, autoplay 6s (paused on hover/focus + reduced-motion), arrows + dots,
 * touch swipe, infinite loop, and crossfade between slides.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  AnimatePresence,
  motion,
  useReducedMotion,
  type PanInfo,
} from "framer-motion";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Banner } from "@/types";
import { cn } from "@/lib/utils";

const AUTOPLAY_MS = 6000;
const SWIPE_THRESHOLD = 48;
const ease = [0.22, 1, 0.36, 1] as const;

interface HeroCarouselProps {
  banners: Banner[];
}

export function HeroCarousel({ banners }: HeroCarouselProps) {
  const reduce = useReducedMotion();
  const [index, setIndex] = useState(0);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [paused, setPaused] = useState(false);
  const timer = useRef<number | null>(null);
  const count = banners.length;

  const go = useCallback(
    (next: number, dir: 1 | -1) => {
      setDirection(dir);
      setIndex(((next % count) + count) % count);
    },
    [count],
  );

  const next = useCallback(() => go(index + 1, 1), [go, index]);
  const prev = useCallback(() => go(index - 1, -1), [go, index]);

  useEffect(() => {
    if (paused || reduce || count <= 1) return;
    timer.current = window.setTimeout(() => next(), AUTOPLAY_MS);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [index, paused, reduce, count, next]);

  const onDragEnd = (_e: unknown, info: PanInfo) => {
    const swipe = info.offset.x + info.velocity.x * 0.12;
    if (swipe < -SWIPE_THRESHOLD) next();
    else if (swipe > SWIPE_THRESHOLD) prev();
  };

  if (!count) return null;
  const slide = banners[index];
  const mobileImage = slide.imageMobile ?? slide.imageDesktop;

  return (
    <section
      aria-roledescription="carousel"
      aria-label="Glavni baner"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className="relative isolate bg-canvas px-2 pt-2 sm:px-3 md:px-4 md:pt-3"
    >
      <div className="relative mx-auto aspect-[4/5] w-full max-w-[calc(var(--container-page)_-_32px)] overflow-hidden rounded-lg bg-canvas md:aspect-[24/10] lg:rounded-xl">
        <AnimatePresence initial={false} mode="popLayout" custom={direction}>
          <motion.div
            key={slide.id}
            className="absolute inset-0 cursor-grab [touch-action:pan-y] active:cursor-grabbing"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.7, ease }}
            drag={count > 1 ? "x" : false}
            dragDirectionLock
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={0.1}
            dragMomentum={false}
            onDragEnd={onDragEnd}
          >
            <Image
              src={mobileImage.url}
              alt={mobileImage.alt ?? slide.title}
              fill
              sizes="(max-width: 767px) calc(100vw - 16px), calc(100vw - 32px)"
              preload
              className={cn(
                "object-contain md:hidden",
                !reduce && "will-change-transform",
              )}
            />
            <Image
              src={slide.imageDesktop.url}
              alt={slide.imageDesktop.alt ?? slide.title}
              fill
              sizes="(max-width: 1440px) calc(100vw - 32px), 1440px"
              preload
              className={cn(
                "hidden object-contain md:block",
                !reduce && "will-change-transform",
              )}
            />
          </motion.div>
        </AnimatePresence>

        {/* CTA label */}
        <div className="pointer-events-none absolute inset-0 flex items-end">
          <div className="w-full px-6 pb-6 md:px-16 md:pb-8 lg:px-24 lg:pb-10 xl:px-32">
            <motion.div
              key={slide.id + "-copy"}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease, delay: 0.1 }}
              className="pointer-events-none"
            >
              {slide.ctaHref && slide.ctaLabel ? (
                <Link
                  href={slide.ctaHref}
                  className="bg-canvas text-ink-900 hover:bg-sand focus-visible:ring-sand/60 pointer-events-auto inline-flex items-center rounded-full px-5 py-2 text-xs transition focus-visible:ring-2 focus-visible:outline-none md:px-6 md:py-3 md:text-sm"
                >
                  {slide.ctaLabel}
                </Link>
              ) : null}
            </motion.div>
          </div>
        </div>

        {/* Arrows */}
        {count > 1 ? (
          <>
            <button
              type="button"
              onClick={prev}
              aria-label="Prethodni baner"
              className="bg-canvas/80 hover:bg-canvas focus-visible:ring-walnut/40 absolute top-1/2 left-4 hidden -translate-y-1/2 items-center justify-center rounded-full p-3 text-ink-900 shadow-soft-2 transition md:inline-flex"
            >
              <ChevronLeft className="size-5" aria-hidden />
            </button>
            <button
              type="button"
              onClick={next}
              aria-label="Sledeći baner"
              className="bg-canvas/80 hover:bg-canvas focus-visible:ring-walnut/40 absolute top-1/2 right-4 hidden -translate-y-1/2 items-center justify-center rounded-full p-3 text-ink-900 shadow-soft-2 transition md:inline-flex"
            >
              <ChevronRight className="size-5" aria-hidden />
            </button>
          </>
        ) : null}

        {/* Dots */}
        {count > 1 ? (
          <div className="absolute right-0 bottom-4 left-0 flex justify-center gap-2">
            {banners.map((b, i) => (
              <button
                key={b.id}
                type="button"
                onClick={() => go(i, i > index ? 1 : -1)}
                aria-label={`Pređi na baner ${i + 1}`}
                aria-current={i === index ? "true" : undefined}
                className={cn(
                  "h-1.5 rounded-full transition-all",
                  i === index
                    ? "w-8 bg-canvas"
                    : "w-3 bg-canvas/50 hover:bg-canvas/80",
                )}
              />
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}
