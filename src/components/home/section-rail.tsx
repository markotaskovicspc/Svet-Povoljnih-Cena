"use client";

/**
 * Section rail — title + "Pogledaj sve →" + horizontal snap rail of product cards.
 * Used for Heroji meseca, Mesečna akcija, Nedeljne akcije, and Ostali tabovi.
 */
import Link from "next/link";
import Image from "next/image";
import { useRef } from "react";
import { motion } from "framer-motion";
import {
  ArrowRight,
  CalendarDays,
  Crown,
  Hourglass,
  Rows3,
  ShieldCheck,
  Sparkles,
  Tag,
} from "lucide-react";
import type { Banner, MediaAsset, Product } from "@/types";
import { ProductCard } from "@/components/product/product-card";
import { DragHint } from "@/components/motion/drag-hint";
import { cn } from "@/lib/utils";
import {
  campaignStickers,
  type CampaignStickerKey,
} from "@/data/campaign-icons";

interface SectionRailProps {
  eyebrow?: string;
  title: string;
  icon?: MediaAsset;
  iconName?: string;
  campaignSticker?: CampaignStickerKey;
  description?: string;
  href: string;
  ctaLabel?: string;
  minimalHeader?: boolean;
  products: Product[];
  banner?: Banner | null;
  dense?: boolean;
  /**
   * On mobile we deliberately strip eyebrow + description for some sections
   * (e.g. Heroji meseca) to keep the layout dense and uncluttered. The
   * desktop layout still shows them.
   */
  mobileMinimal?: boolean;
  /**
   * Keeps the mobile title and CTA on one compact row for PDP rails.
   */
  compactMobileHeader?: boolean;
}

export function SectionRail({
  eyebrow,
  title,
  icon,
  iconName,
  campaignSticker,
  description,
  href,
  ctaLabel = "Pogledaj sve",
  products,
  minimalHeader,
  banner,
  dense,
  mobileMinimal,
  compactMobileHeader,
}: SectionRailProps) {
  const railRef = useRef<HTMLDivElement | null>(null);
  if (!products.length) return null;

  const LucideIcon = iconName ? sectionIconMap[iconName as keyof typeof sectionIconMap] : null;
  const titleIcon = icon ?? (campaignSticker ? campaignStickers[campaignSticker] : undefined);
  const showBanner = Boolean(banner && !minimalHeader);

  return (
    <section
      className={cn(
        "mx-auto w-full max-w-[var(--container-page)] px-4 md:px-6",
        dense ? "py-4 md:py-6" : "py-5 md:py-10",
      )}
    >
      {showBanner && banner ? <SectionBanner banner={banner} href={href} /> : null}

      <header
        className={cn(
          "flex items-center justify-between",
          compactMobileHeader
            ? "flex-nowrap gap-2 md:flex-wrap md:gap-3"
            : "flex-wrap gap-3",
          showBanner && "mt-4 md:mt-6",
        )}
      >
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.4 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          className={cn(
            "min-w-0",
            compactMobileHeader ? "flex-1" : minimalHeader ? "flex-1" : "max-w-2xl",
          )}
        >
          {!minimalHeader && eyebrow ? (
            <p
              className={cn(
                "font-mono text-xs tracking-[0.2em] text-walnut uppercase",
                mobileMinimal && "hidden md:block",
              )}
            >
              {eyebrow}
            </p>
          ) : null}
          <div
            className={cn(
              "flex min-w-0 items-center gap-3 md:gap-4",
              compactMobileHeader && "gap-2 md:gap-4",
              !minimalHeader && (dense ? "mt-1" : "mt-1 md:mt-2"),
            )}
          >
            {titleIcon ? (
              <span className="flex size-11 shrink-0 items-center justify-center md:size-14">
                <Image
                  src={titleIcon.url}
                  alt={titleIcon.alt ?? ""}
                  width={titleIcon.width ?? 80}
                  height={titleIcon.height ?? 80}
                  unoptimized={titleIcon.url.endsWith(".svg")}
                  className="max-h-full max-w-full object-contain"
                />
              </span>
            ) : LucideIcon ? (
              <span className="bg-surface ring-border/60 flex size-12 shrink-0 items-center justify-center rounded-lg ring-1 shadow-soft-1 md:size-16">
                <LucideIcon className="size-6 text-walnut md:size-8" aria-hidden />
              </span>
            ) : null}
            <Link
              href={href}
              className="group/title min-w-0 rounded-sm focus-visible:ring-2 focus-visible:ring-walnut/40 focus-visible:outline-none"
            >
              <h2
                className={cn(
                  "font-display min-w-0 leading-tight text-ink-900 transition group-hover/title:text-walnut md:text-4xl",
                  compactMobileHeader
                    ? "text-[1.05rem] whitespace-nowrap min-[375px]:text-xl sm:text-2xl"
                    : "text-2xl",
                )}
              >
                {title}
              </h2>
            </Link>
          </div>
          {!minimalHeader && description ? (
            <p
              className={cn(
                "mt-2 max-w-prose text-base text-ink-700 md:mt-3",
                mobileMinimal && "hidden md:block",
              )}
            >
              {description}
            </p>
          ) : null}
        </motion.div>
        <Link
          href={href}
          className={cn(
            "hover:text-walnut focus-visible:ring-walnut/40 ml-auto inline-flex shrink-0 items-center gap-1 font-semibold text-ink-900 transition focus-visible:rounded-full focus-visible:ring-2 focus-visible:outline-none",
            compactMobileHeader ? "text-[11px] whitespace-nowrap min-[375px]:text-xs sm:text-sm" : "text-sm",
          )}
        >
          {ctaLabel}
          <ArrowRight
            className={cn("shrink-0", compactMobileHeader ? "size-3.5 sm:size-4" : "size-4")}
            aria-hidden
          />
        </Link>
      </header>

      <div
        ref={railRef}
        className={cn(
          "relative -mx-4 overflow-x-auto px-4 [scrollbar-width:none] md:-mx-6 md:px-6 [&::-webkit-scrollbar]:hidden",
          dense ? "mt-2 md:mt-3" : "mt-3 md:mt-5",
        )}
      >
        <DragHint scopeRef={railRef} />
        <motion.ul
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, amount: 0.1 }}
          variants={{
            hidden: {},
            show: { transition: { staggerChildren: 0.05 } },
          }}
          className="flex snap-x snap-mandatory gap-3 pb-2 md:gap-4"
        >
          {products.map((p) => (
            <motion.li
              key={p.sku}
              variants={{
                hidden: { opacity: 0, y: 12 },
                show: {
                  opacity: 1,
                  y: 0,
                  transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] },
                },
              }}
              className="w-[35vw] min-w-[138px] shrink-0 snap-start sm:w-[28vw] md:w-[calc((100%_-_80px)/5)] md:min-w-[180px] 2xl:w-[calc((100%_-_80px)/6)]"
            >
              <ProductCard
                product={p}
                campaignSticker={campaignSticker}
                className="h-full"
              />
            </motion.li>
          ))}
        </motion.ul>
      </div>
    </section>
  );
}

function SectionBanner({ banner, href }: { banner: Banner; href: string }) {
  const target = banner.ctaHref ?? href;

  return (
    <Link
      href={target}
      className="group/banner block overflow-hidden rounded-2xl bg-ink-900 text-canvas shadow-soft-2 focus-visible:ring-2 focus-visible:ring-walnut/40 focus-visible:outline-none md:rounded-3xl"
    >
      <div className="relative aspect-[16/7] min-h-[160px] md:aspect-[24/7]">
        <Image
          src={banner.imageDesktop.url}
          alt={banner.imageDesktop.alt ?? banner.title}
          fill
          sizes="(min-width: 1440px) 1392px, 100vw"
          className="object-cover opacity-[0.82] transition duration-700 group-hover/banner:scale-[1.02]"
        />
        <div
          aria-hidden
          className="absolute inset-0 bg-gradient-to-r from-ink-900/82 via-ink-900/34 to-ink-900/5"
        />
        <div className="absolute inset-0 flex items-center p-5 md:p-8">
          <div className="max-w-xl">
            {banner.badgeLabel ? (
              <span className="inline-flex rounded-full bg-canvas/92 px-3 py-1 text-[11px] font-semibold text-ink-900 shadow-soft-1">
                {banner.badgeLabel}
              </span>
            ) : null}
            <p className="font-display mt-3 text-2xl leading-tight md:text-4xl">
              {banner.title}
            </p>
            {banner.subtitle ? (
              <p className="mt-2 hidden max-w-md text-sm text-canvas/82 md:block">
                {banner.subtitle}
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </Link>
  );
}

const sectionIconMap = {
  CalendarDays,
  Crown,
  Hourglass,
  Rows3,
  ShieldCheck,
  Sparkles,
  Tag,
};
