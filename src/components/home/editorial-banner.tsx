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
    <section className="mx-auto w-full max-w-[var(--container-page)] px-6 py-12 md:py-20">
      <motion.article
        initial={{ opacity: 0, y: 16 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.3 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        className="relative isolate overflow-hidden rounded-3xl bg-ink-900 text-canvas shadow-soft-4"
      >
        <div className="relative aspect-[16/10] w-full md:aspect-[24/9]">
          <Image
            src={banner.imageDesktop.url}
            alt={banner.imageDesktop.alt ?? banner.title}
            fill
            sizes="(min-width: 1280px) 1280px, 100vw"
            className="object-cover opacity-80"
          />
          <div
            aria-hidden
            className="from-ink-900/85 via-ink-900/40 absolute inset-0 bg-gradient-to-r to-transparent"
          />
        </div>
        <div className="absolute inset-0 flex items-end md:items-center">
          <div className="max-w-xl px-8 pb-8 md:px-12 md:pb-0">
            <p className="font-mono text-xs tracking-[0.2em] text-sand uppercase">
              Kolekcija meseca
            </p>
            <h2 className="font-display mt-3 text-3xl leading-[1.1] md:text-5xl">
              {banner.title}
            </h2>
            {banner.subtitle ? (
              <p className="mt-4 max-w-md text-canvas/80 md:text-lg">
                {banner.subtitle}
              </p>
            ) : null}
            {banner.ctaHref && banner.ctaLabel ? (
              <Link
                href={banner.ctaHref}
                className="bg-canvas text-ink-900 hover:bg-sand focus-visible:ring-sand/60 mt-6 inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm shadow-soft-3 transition focus-visible:ring-2 focus-visible:outline-none"
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
