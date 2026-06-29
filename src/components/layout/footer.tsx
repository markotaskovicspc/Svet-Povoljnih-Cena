import Link from "next/link";
import Image from "next/image";
import { footerColumns, paymentMethods, socials } from "@/data/site";
import { Marquee } from "@/components/motion/marquee";
import { BRAND } from "@/lib/brand";

const SOCIAL_ICON_SRC: Record<string, string> = {
  fb: "/icons/facebook.svg",
  ig: "/icons/instagram.svg",
  tt: "/icons/tiktok.svg",
};

export function Footer() {
  return (
    <footer className="bg-white text-ink-900">
      <div className="mx-auto max-w-[var(--container-page)] px-6 py-12 md:py-16">
        <div className="grid gap-10 md:grid-cols-12 md:gap-12">
          <div className="md:col-span-4">
            <div className="flex items-center gap-3 sm:gap-4">
              <Link href="/" aria-label={`${BRAND.name} — početna`} className="inline-block shrink-0">
                <Image
                  src="/logo.svg"
                  alt={BRAND.name}
                  width={1193}
                  height={198}
                  className="h-auto w-[160px] object-contain min-[390px]:w-[180px] md:w-[328px] md:max-w-[30vw]"
                />
              </Link>

              <div>
                <ul className="flex items-center gap-2">
                  {socials.map((s) => {
                    const icon = SOCIAL_ICON_SRC[s.id] ?? "/icons/facebook.svg";
                    return (
                      <li key={s.id}>
                        <Link
                          href={s.href}
                          target="_blank"
                          rel="noreferrer"
                          aria-label={s.label}
                          className="inline-flex size-10 items-center justify-center rounded-full bg-white transition hover:scale-105 focus-visible:ring-2 focus-visible:ring-brand-blue/35 focus-visible:outline-none"
                        >
                          <Image
                            src={icon}
                            alt=""
                            width={24}
                            height={24}
                            className="size-6"
                          />
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
          </div>

          {/*
           * Footer link grid.
           * Mobile: 2 columns (compact, packs links into rows instead of one tall list).
           * Tablet+: 3 columns. Desktop: 4 columns.
           */}
          <nav
            aria-label="Footer navigacija"
            className="grid grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-3 md:col-span-8 md:grid-cols-4"
          >
            {footerColumns.map((col) => (
              <div key={col.title}>
                <h3 className="font-display text-base font-bold tracking-normal text-brand-blue">
                  {col.title}
                </h3>
                <ul className="mt-3 space-y-1.5 text-sm text-ink-500 md:mt-4 md:space-y-2">
                  {col.links.map((l) => (
                    <li key={l.href}>
                      <Link
                        href={l.href}
                        className="transition hover:text-brand-blue"
                      >
                        {l.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>
      </div>

      <div className="border-t border-border">
        <div className="mx-auto max-w-[var(--container-page)] px-6 py-5">
          <div className="flex items-center gap-4">
            <span className="font-mono text-[10px] tracking-[0.2em] text-ink-500 shrink-0 uppercase">
              Načini plaćanja
            </span>
            <Marquee durationSec={36} className="flex-1">
              {paymentMethods.map((p) => (
                <Link
                  key={p.id}
                  href={p.href}
                  aria-label={p.label}
                  className="inline-flex h-8 items-center gap-2 rounded-md border border-border bg-muted-bg px-3 font-mono text-[11px] tracking-wide text-ink-700 transition hover:border-brand-blue hover:text-brand-blue"
                >
                  {p.id === "ips" ? (
                    <Image
                      src="/icons/ips-skeniraj.svg"
                      alt=""
                      width={55}
                      height={18}
                      className="h-[18px] w-auto"
                    />
                  ) : null}
                  <span>{p.label}</span>
                </Link>
              ))}
            </Marquee>
          </div>
        </div>
      </div>

    </footer>
  );
}
