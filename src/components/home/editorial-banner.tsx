"use client";

/** Editorial banner — full-bleed image + copy + CTA between rails. Admin-managed. */
import Image from "next/image";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import type { Banner } from "@/types";

interface EditorialBannerProps {
  banner: Banner;
}

export function EditorialBanner({ banner }: EditorialBannerProps) {
  return (
    <section className="mx-auto w-full max-w-[var(--container-page)] px-2 py-12 sm:px-3 md:px-4 md:py-20">
      <motion.article
        initial={{ opacity: 0, y: 16 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.3 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        className="relative isolate overflow-hidden rounded-lg bg-ink-900 text-canvas shadow-soft-4 lg:rounded-xl"
      >
        <div className="relative aspect-[16/7] min-h-[160px] w-full md:aspect-[24/7] md:min-h-0">
          <Image
            src={banner.imageDesktop.url}
            alt={banner.imageDesktop.alt ?? banner.title}
            fill
            sizes="(max-width: 767px) calc(100vw - 16px), calc(100vw - 32px)"
            className="object-cover opacity-80"
          />
          <div
            aria-hidden
            className="from-ink-900/85 via-ink-900/40 absolute inset-0 bg-gradient-to-r to-transparent"
          />
        </div>
        <div className="relative flex items-start bg-ink-900 px-5 py-6 md:absolute md:inset-0 md:items-center md:bg-transparent md:px-0 md:py-0">
          <div className="max-w-xl md:px-12">
            <p className="font-mono text-[10px] tracking-[0.2em] text-sand uppercase md:text-xs">
              Kolekcija meseca
            </p>
            <h2 className="font-display mt-2 text-2xl leading-tight md:mt-3 md:text-5xl md:leading-[1.1]">
              {banner.title}
            </h2>
            {banner.subtitle ? (
              <p className="mt-3 max-w-md text-sm leading-relaxed text-canvas/82 md:mt-4 md:text-lg">
                {banner.subtitle}
              </p>
            ) : null}
            {banner.ctaHref && banner.ctaLabel ? (
              <Link
                href={banner.ctaHref}
                className="bg-canvas text-ink-900 hover:bg-sand focus-visible:ring-sand/60 mt-5 inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm shadow-soft-3 transition focus-visible:ring-2 focus-visible:outline-none md:mt-6 md:px-6 md:py-3"
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
