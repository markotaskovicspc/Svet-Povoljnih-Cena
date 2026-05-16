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
        className="group mx-auto grid w-full max-w-[var(--container-page)] gap-4 px-4 py-6 outline-none focus-visible:ring-2 focus-visible:ring-white/60 md:grid-cols-[220px_1fr_auto] md:items-center md:gap-5 md:px-6 md:py-10"
      >
        <div className="flex items-center justify-center md:justify-start">
          <Image
            src={image.url}
            alt={image.alt ?? banner.title}
            width={image.width ?? 1191}
            height={image.height ?? 895}
            unoptimized
            className="h-auto w-36 rounded-2xl bg-white p-3 shadow-soft-2 md:w-44 md:rounded-md md:p-2"
          />
        </div>
        <div className="min-w-0 max-w-3xl">
          <h2 className="font-display text-3xl leading-tight text-white md:text-5xl">
            {banner.title}
          </h2>
          {banner.subtitle ? (
            <p className="mt-2 text-sm leading-relaxed text-white/82 md:mt-3 md:text-base">
              {banner.subtitle}
            </p>
          ) : null}
        </div>
        <span
          className="inline-flex w-fit items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-medium text-brand-blue transition group-hover:bg-brand-blue-50 group-focus-visible:ring-2 group-focus-visible:ring-white/50"
        >
          <ShieldCheck className="size-4" aria-hidden />
          {banner.ctaLabel ?? "Pogledaj ponudu"}
          <ArrowRight className="size-4" aria-hidden />
        </span>
      </Link>
    </section>
  );
}
