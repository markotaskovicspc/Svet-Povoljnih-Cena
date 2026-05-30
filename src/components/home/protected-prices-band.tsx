import Image from "next/image";
import Link from "next/link";
import { ArrowRight, ShieldCheck } from "lucide-react";
import type { Banner } from "@/types";
import { cn } from "@/lib/utils";

export function ProtectedPricesBand({
  banner,
  compact,
}: {
  banner: Banner;
  compact?: boolean;
}) {
  const href = banner.ctaHref ?? "/niske-cene-pod-zastitom";
  const image = banner.imageMobile ?? banner.imageDesktop;

  return (
    <section
      className={cn(
        "mx-auto w-full max-w-[var(--container-page)] px-4 md:px-6",
        compact ? "py-4 md:py-5" : "py-5 md:py-8",
      )}
    >
      <Link
        href={href}
        className="group block overflow-hidden rounded-lg bg-brand-blue text-white shadow-soft-2 outline-none focus-visible:ring-2 focus-visible:ring-walnut/40"
      >
        <div className="relative grid min-h-[170px] grid-cols-[112px_1fr] items-center gap-4 px-4 py-5 md:aspect-[24/7] md:min-h-[230px] md:grid-cols-[260px_minmax(0,1fr)_auto] md:gap-8 md:px-8 md:py-7">
          <div className="flex aspect-square w-full max-w-[112px] items-center justify-center justify-self-center rounded-lg bg-white p-3 md:max-w-[190px] md:p-5">
            <Image
              src={image.url}
              alt={image.alt ?? banner.title}
              width={image.width ?? 1191}
              height={image.height ?? 895}
              unoptimized
              className="h-full w-full object-contain"
            />
          </div>

          <div className="min-w-0">
            <h2 className="font-display text-3xl leading-tight font-bold md:text-5xl">
              {banner.title}
            </h2>
            {banner.subtitle ? (
              <p className="mt-2 max-w-2xl text-justify text-sm leading-relaxed text-white/84 md:text-base">
                {banner.subtitle}
              </p>
            ) : null}
          </div>

          <span className="col-span-2 inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-white px-4 py-2.5 text-sm font-semibold whitespace-nowrap text-brand-blue transition group-hover:bg-brand-blue-50 md:col-span-1 md:self-end">
            <ShieldCheck className="size-4 shrink-0" aria-hidden />
            {banner.ctaLabel ?? "Pogledaj ponudu"}
            <ArrowRight className="size-4 shrink-0" aria-hidden />
          </span>
        </div>
      </Link>
    </section>
  );
}
