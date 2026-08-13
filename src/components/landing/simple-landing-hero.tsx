import Image from "next/image";
import Link from "next/link";
import type { LandingPageSnapshot } from "@/lib/landing-pages/blocks";

type SimpleHeroSnapshot = Pick<
  LandingPageSnapshot,
  | "heroImageUrl"
  | "heroMobileImageUrl"
  | "heroImageAlt"
  | "heroCtaLabel"
  | "heroCtaHref"
>;

export function SimpleLandingHero({ snapshot }: { snapshot: SimpleHeroSnapshot }) {
  const image = snapshot.heroImageUrl;
  const external = snapshot.heroCtaHref?.startsWith("https://") ?? false;
  return (
    <section
      aria-label="Glavni baner"
      className="relative isolate bg-canvas px-2 pt-2 sm:px-3 md:px-4 md:pt-3"
    >
      <div className="relative mx-auto aspect-square w-full max-w-[calc(var(--container-page)_-_32px)] overflow-hidden rounded-lg bg-ink-900 shadow-soft-3 md:aspect-[24/7] lg:rounded-xl">
        {image ? (
          <>
            <Image
              src={snapshot.heroMobileImageUrl || image}
              alt={snapshot.heroImageAlt || ""}
              fill
              sizes="(max-width: 767px) calc(100vw - 16px), calc(100vw - 32px)"
              preload
              className="object-cover md:hidden"
            />
            <Image
              src={image}
              alt={snapshot.heroImageAlt || ""}
              fill
              sizes="(max-width: 1440px) calc(100vw - 32px), 1440px"
              preload
              className="hidden object-cover md:block"
            />
          </>
        ) : null}
        {snapshot.heroCtaLabel && snapshot.heroCtaHref ? (
          <div className="pointer-events-none absolute inset-0 flex items-end">
            <div className="w-full px-6 pb-6 md:px-16 md:pb-8 lg:px-24 lg:pb-10 xl:px-32">
              <Link
                href={snapshot.heroCtaHref}
                target={external ? "_blank" : undefined}
                rel={external ? "noreferrer noopener" : undefined}
                className="pointer-events-auto inline-flex items-center rounded-full bg-canvas px-5 py-2 text-xs text-ink-900 shadow-soft-3 transition hover:bg-sand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sand/60 md:px-6 md:py-3 md:text-sm"
              >
                {snapshot.heroCtaLabel}
              </Link>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
