"use client";

/**
 * Home hero banner carousel — Phase 1B.
 * Full-width, autoplay 6s (paused on hover/focus + reduced-motion), arrows + dots,
 * touch swipe, infinite loop, Ken-Burns zoom on active slide, crossfade between slides.
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
      <div className="relative mx-auto h-[48dvh] max-h-[420px] min-h-[300px] w-full max-w-[calc(var(--container-page)_-_32px)] overflow-hidden rounded-lg bg-ink-900 shadow-soft-3 md:h-auto md:aspect-[24/10] md:min-h-0 lg:rounded-xl">
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
              src={(slide.imageMobile ?? slide.imageDesktop).url}
              alt={(slide.imageMobile ?? slide.imageDesktop).alt ?? slide.title}
              fill
              sizes="(max-width: 767px) calc(100vw - 16px), calc(100vw - 32px)"
              priority
              className={cn(
                "object-cover md:hidden",
                !reduce && "will-change-transform",
              )}
            />
            <Image
              src={slide.imageDesktop.url}
              alt={slide.imageDesktop.alt ?? slide.title}
              fill
              sizes="(max-width: 1440px) calc(100vw - 32px), 1440px"
              priority
              className={cn(
                "hidden object-cover md:block",
                !reduce && "will-change-transform",
              )}
            />
            {/* Ken-Burns zoom layer */}
            {!reduce ? (
              <motion.div
                aria-hidden
                className="absolute inset-0"
                initial={{ scale: 1 }}
                animate={{ scale: 1.08 }}
                transition={{ duration: 7, ease: "linear" }}
              />
            ) : null}
            <div
              aria-hidden
              className="from-ink-900/85 via-ink-900/20 absolute inset-0 bg-gradient-to-r to-transparent"
            />
          </motion.div>
        </AnimatePresence>

        {/* Caption */}
        <div className="pointer-events-none absolute inset-0 flex items-end md:items-center">
          <div className="w-full px-6 pb-6 md:px-16 md:pb-0 lg:px-24 xl:px-32">
            <motion.div
              key={slide.id + "-copy"}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease, delay: 0.1 }}
              className="pointer-events-none max-w-xl text-canvas"
            >
              <p className="font-mono text-[10px] tracking-[0.2em] text-sand uppercase md:text-xs">
                {slide.subtitle ? "Aktuelno" : "Predstavljamo"}
              </p>
              <h2 className="font-display mt-2 max-w-[13ch] text-2xl leading-[1.1] md:mt-3 md:max-w-none md:text-6xl">
                {slide.title}
              </h2>
              {slide.subtitle ? (
                <p className="mt-2 hidden max-w-md text-base text-canvas/80 md:block md:text-lg">
                  {slide.subtitle}
                </p>
              ) : null}
              {slide.ctaHref && slide.ctaLabel ? (
                <Link
                  href={slide.ctaHref}
                  className="bg-canvas text-ink-900 hover:bg-sand focus-visible:ring-sand/60 pointer-events-auto mt-3 inline-flex items-center rounded-full px-5 py-2 text-xs shadow-soft-3 transition focus-visible:ring-2 focus-visible:outline-none md:mt-6 md:px-6 md:py-3 md:text-sm"
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
                  i === index ? "w-8 bg-canvas" : "w-3 bg-canvas/50 hover:bg-canvas/80",
                )}
              />
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}
