"use client";

/** Editorial banner — full-bleed image + copy + CTA between rails. Admin-managed. */
import Image from "next/image";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import type { Banner } from "@/types";
import { cn } from "@/lib/utils";

interface EditorialBannerProps {
  banner: Banner;
  compact?: boolean;
}

export function EditorialBanner({
  banner,
  compact = false,
}: EditorialBannerProps) {
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
        className="relative isolate overflow-hidden rounded-lg bg-canvas lg:rounded-xl"
      >
        <div className="relative aspect-[16/7] min-h-[160px] w-full md:aspect-[24/9] md:min-h-0">
          <Image
            src={(banner.imageMobile ?? banner.imageDesktop).url}
            alt={(banner.imageMobile ?? banner.imageDesktop).alt ?? banner.title}
            fill
            sizes="calc(100vw - 16px)"
            className="object-cover md:hidden"
          />
          <Image
            src={banner.imageDesktop.url}
            alt={banner.imageDesktop.alt ?? banner.title}
            fill
            sizes="(max-width: 767px) calc(100vw - 16px), calc(100vw - 32px)"
            className="hidden object-cover md:block"
          />
        </div>
        <div className="pointer-events-none absolute inset-0 flex items-end px-5 pb-4 md:px-12 md:pb-10">
          {banner.ctaHref && banner.ctaLabel ? (
            <Link
              href={banner.ctaHref}
              className="bg-canvas text-ink-900 hover:bg-sand focus-visible:ring-sand/60 pointer-events-auto inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm shadow-soft-3 transition focus-visible:ring-2 focus-visible:outline-none md:px-6 md:py-3"
            >
              {banner.ctaLabel}
              <ArrowRight className="size-4" aria-hidden />
            </Link>
          ) : null}
        </div>
      </motion.article>
    </section>
  );
}
