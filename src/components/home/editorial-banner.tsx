"use client";

/** Editorial banner — full-bleed image + copy + CTA between rails. Admin-managed. */
import Image from "next/image";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { useState, type SyntheticEvent } from "react";
import type { Banner } from "@/types";
import { cn } from "@/lib/utils";

interface EditorialBannerProps {
  banner: Banner;
  compact?: boolean;
  eyebrow?: string;
}

export function EditorialBanner({
  banner,
  compact = false,
  eyebrow = "Kolekcija meseca",
}: EditorialBannerProps) {
  const mobileImage = banner.imageMobile ?? banner.imageDesktop;
  const [mobileAspect, setMobileAspect] = useState(
    mobileImage.width && mobileImage.height
      ? mobileImage.width / mobileImage.height
      : 16 / 7,
  );
  const [desktopAspect, setDesktopAspect] = useState(
    banner.imageDesktop.width && banner.imageDesktop.height
      ? banner.imageDesktop.width / banner.imageDesktop.height
      : 24 / 7,
  );

  const updateAspect = (
    event: SyntheticEvent<HTMLImageElement>,
    setter: (aspect: number) => void,
  ) => {
    const { naturalWidth, naturalHeight } = event.currentTarget;
    if (naturalWidth && naturalHeight) setter(naturalWidth / naturalHeight);
  };

  return (
    <section
      className={cn(
        "mx-auto w-full max-w-[var(--container-page)] px-2 sm:px-3 md:px-4",
        compact ? "py-4 md:py-5" : "py-12 md:py-20",
      )}
    >
      <motion.article
        initial={{ opacity: 0, y: 16 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.3 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        className="relative isolate overflow-hidden rounded-lg bg-canvas text-canvas lg:rounded-xl"
      >
        <div
          className="relative w-full md:hidden"
          style={{ aspectRatio: mobileAspect }}
        >
          <Image
            src={mobileImage.url}
            alt={mobileImage.alt ?? banner.title}
            fill
            sizes="calc(100vw - 16px)"
            onLoad={(event) => updateAspect(event, setMobileAspect)}
            className="object-contain"
          />
        </div>
        <div
          className="relative hidden w-full md:block"
          style={{ aspectRatio: desktopAspect }}
        >
          <Image
            src={banner.imageDesktop.url}
            alt={banner.imageDesktop.alt ?? banner.title}
            fill
            sizes="(max-width: 767px) calc(100vw - 16px), calc(100vw - 32px)"
            onLoad={(event) => updateAspect(event, setDesktopAspect)}
            className="object-contain"
          />
        </div>
        <div className="pointer-events-none absolute inset-0 flex items-end px-5 pb-5 md:items-center md:px-0 md:pb-0">
          <div className="max-w-xl md:px-12">
            <p className="font-mono hidden text-xs tracking-[0.2em] text-sand uppercase md:block">
              {eyebrow}
            </p>
            <h2 className="font-display mt-3 hidden text-5xl leading-[1.1] md:block">
              {banner.title}
            </h2>
            {banner.subtitle ? (
              <p className="mt-4 hidden max-w-md text-lg leading-relaxed text-canvas/82 md:block">
                {banner.subtitle}
              </p>
            ) : null}
            {banner.ctaHref && banner.ctaLabel ? (
              <Link
                href={banner.ctaHref}
                className="bg-canvas text-ink-900 hover:bg-sand focus-visible:ring-sand/60 pointer-events-auto inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm transition focus-visible:ring-2 focus-visible:outline-none md:mt-6 md:px-6 md:py-3"
              >
                {banner.ctaLabel}
                <ArrowRight className="size-4" aria-hidden />
              </Link>
            ) : null}
          </div>
        </div>
      </motion.article>
    </section>
  );
}
