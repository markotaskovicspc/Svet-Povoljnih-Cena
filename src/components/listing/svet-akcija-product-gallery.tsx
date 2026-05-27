"use client";

import Image from "next/image";
import { useCallback, useRef, useState } from "react";
import { PackageSearch } from "lucide-react";
import { cn } from "@/lib/utils";

interface GalleryImage {
  url: string;
  alt?: string | null;
  width?: number | null;
  height?: number | null;
  blurDataUrl?: string | null;
}

interface SvetAkcijaProductGalleryProps {
  images: GalleryImage[];
  productName: string;
}

export function SvetAkcijaProductGallery({
  images,
  productName,
}: SvetAkcijaProductGalleryProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef({
    pointerId: -1,
    startX: 0,
    scrollLeft: 0,
    didDrag: false,
  });
  const [active, setActive] = useState(0);

  const syncActive = useCallback(() => {
    const track = trackRef.current;
    if (!track) return;
    const index = Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
    setActive(Math.max(0, Math.min(index, images.length - 1)));
  }, [images.length]);

  const goTo = useCallback(
    (index: number) => {
      if (!images.length) return;
      const nextIndex = Math.max(0, Math.min(index, images.length - 1));
      setActive(nextIndex);
      trackRef.current
        ?.querySelector<HTMLElement>(`[data-gallery-slide="${nextIndex}"]`)
        ?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
    },
    [images.length],
  );

  const handleDragStart = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "touch" || event.button !== 0) return;

    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      scrollLeft: event.currentTarget.scrollLeft,
      didDrag: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }, []);

  const handleDragMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (drag.pointerId !== event.pointerId) return;

    const distance = event.clientX - drag.startX;
    if (Math.abs(distance) > 4) drag.didDrag = true;
    if (drag.didDrag) {
      event.preventDefault();
      event.currentTarget.scrollLeft = drag.scrollLeft - distance;
    }
  }, []);

  const finishDrag = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (drag.pointerId !== event.pointerId) return;

      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      dragRef.current.pointerId = -1;
      syncActive();
    },
    [syncActive],
  );

  if (!images.length) {
    return (
      <section
        aria-label="Galerija proizvoda"
        className="overflow-hidden rounded-md border border-border bg-white"
      >
        <div className="relative flex aspect-[4/3] items-center justify-center bg-white text-ink-300">
          <PackageSearch className="size-20" aria-hidden />
          <span className="sr-only">Slika nije uneta u izvorni katalog</span>
        </div>
      </section>
    );
  }

  return (
    <section
      aria-label="Galerija proizvoda"
      className="overflow-hidden rounded-md border border-border bg-white"
    >
      <div
        ref={trackRef}
        onScroll={syncActive}
        onPointerDown={handleDragStart}
        onPointerMove={handleDragMove}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
        className="flex cursor-grab touch-pan-x snap-x snap-mandatory select-none overflow-x-auto overscroll-x-contain bg-white active:cursor-grabbing [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        aria-roledescription="carousel"
      >
        {images.map((image, index) => (
          <div
            key={`${image.url}-${index}`}
            data-gallery-slide={index}
            className="relative aspect-[4/3] min-w-full snap-center"
          >
            <Image
              src={image.url}
              alt={image.alt ?? productName}
              fill
              priority={index === 0}
              draggable={false}
              sizes="(min-width: 1024px) 48vw, 100vw"
              className="object-contain p-4"
            />
          </div>
        ))}
      </div>

      {images.length > 1 ? (
        <>
          <div className="flex justify-center gap-1.5 px-3 pt-3 md:hidden">
            {images.map((_, index) => (
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

          <div className="grid grid-cols-4 gap-2 p-2 sm:grid-cols-5">
            {images.map((item, index) => (
              <button
                key={`${item.url}-${index}`}
                type="button"
                onClick={() => goTo(index)}
                aria-label={`Prikaži sliku ${index + 1}`}
                aria-current={index === active ? "true" : undefined}
                className={cn(
                  "relative aspect-square overflow-hidden rounded-md border bg-white transition focus-visible:ring-2 focus-visible:ring-brand-blue/35 focus-visible:outline-none",
                  index === active ? "border-brand-blue" : "border-border",
                )}
              >
                <Image
                  src={item.url}
                  alt=""
                  fill
                  draggable={false}
                  sizes="96px"
                  className="object-contain p-1.5"
                />
              </button>
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
}
