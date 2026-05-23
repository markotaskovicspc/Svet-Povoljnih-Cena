import Image from "next/image";
import Link from "next/link";
import { ShieldCheck, ArrowRight } from "lucide-react";
import type { Banner } from "@/types";

export function ProtectedPricesBand({ banner }: { banner: Banner }) {
  const href = banner.ctaHref ?? "/niske-cene-pod-zastitom";
  const image = banner.imageMobile ?? banner.imageDesktop;
  return (
    <section className="bg-brand-blue text-white">
      <Link
        href={href}
        className="group mx-auto block w-full max-w-[var(--container-page)] px-4 py-7 outline-none sm:px-6 md:px-8 md:py-12"
      >
        <div className="grid grid-cols-[minmax(128px,0.42fr)_1fr] items-start gap-x-4 gap-y-5 md:grid-cols-[260px_minmax(0,1fr)] md:gap-x-10 lg:grid-cols-[300px_minmax(0,720px)]">
          <div className="row-span-2">
            <Image
              src={image.url}
              alt={image.alt ?? banner.title}
              width={image.width ?? 1191}
              height={image.height ?? 895}
              unoptimized
              className="h-auto w-full max-w-[280px] rounded-lg bg-white p-2 shadow-soft-2 md:max-w-[300px]"
            />
          </div>

          <div className="max-w-3xl pt-1 md:pt-3">
            {banner.subtitle ? (
              <p className="text-[15px] leading-snug text-white/82 md:text-2xl md:leading-snug">
                {banner.subtitle}
              </p>
            ) : null}
          </div>

          <span className="inline-flex min-h-12 w-full max-w-[390px] items-center justify-center gap-2 self-end rounded-full bg-white px-4 py-3 text-[15px] font-semibold text-brand-blue transition group-hover:bg-brand-blue-50 group-focus-visible:ring-2 group-focus-visible:ring-white/50 md:min-h-14 md:gap-3 md:px-5 md:text-xl">
            <ShieldCheck className="size-4 shrink-0 md:size-5" aria-hidden />
            <span className="truncate">{banner.ctaLabel ?? "Pogledaj ponudu"}</span>
            <ArrowRight className="size-4 shrink-0 md:size-5" aria-hidden />
          </span>
        </div>

        <div className="mt-7 h-px w-full bg-brand-blue-700/70 md:mt-10" />

        <h2 className="mt-5 font-display text-[clamp(2.4rem,11vw,3.5rem)] leading-none text-white md:mt-8 md:text-7xl">
          {banner.title}
        </h2>
      </Link>
    </section>
  );
}
