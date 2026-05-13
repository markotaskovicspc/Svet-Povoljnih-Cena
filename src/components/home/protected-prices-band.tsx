import Image from "next/image";
import Link from "next/link";
import { ShieldCheck, ArrowRight } from "lucide-react";

export function ProtectedPricesBand() {
  return (
    <section className="bg-brand-blue text-white">
      <div className="mx-auto grid w-full max-w-[var(--container-page)] gap-6 px-6 py-8 md:grid-cols-[220px_1fr_auto] md:items-center md:py-10">
        <div className="flex items-center">
          <Image
            src="/brand/nctz.svg"
            alt="Niske cene pod trajnom zaštitom"
            width={1191}
            height={895}
            unoptimized
            className="h-auto w-36 rounded-md bg-white p-2 md:w-44"
          />
        </div>
        <div className="max-w-3xl">
          <p className="font-mono text-[11px] tracking-[0.2em] text-white/65 uppercase">
            Trajna akcija od 01.05.2026.
          </p>
          <h2 className="font-display mt-2 text-2xl leading-tight text-white md:text-4xl">
            Niske cene pod trajnom zaštitom
          </h2>
          <p className="mt-2 text-sm text-white/78 md:text-base">
            Posebno označeni artikli ostaju u stalnoj zaštićenoj ponudi, bez
            odbrojavanja i kratkih rokova.
          </p>
        </div>
        <Link
          href="/niske-cene-pod-zastitom"
          className="inline-flex w-fit items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-medium text-brand-blue transition hover:bg-brand-blue-50 focus-visible:ring-2 focus-visible:ring-white/50 focus-visible:outline-none"
        >
          <ShieldCheck className="size-4" aria-hidden />
          Pogledaj ponudu
          <ArrowRight className="size-4" aria-hidden />
        </Link>
      </div>
    </section>
  );
}
