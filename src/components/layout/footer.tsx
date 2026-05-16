import Link from "next/link";
import Image from "next/image";
import { footerColumns, paymentMethods, socials } from "@/data/site";
import { Marquee } from "@/components/motion/marquee";

/**
 * Inline-SVG brand glyphs. We don't pull these from lucide-react because
 * the installed version (1.14) doesn't ship Facebook / Instagram / TikTok
 * brand icons (they were removed from the open-source set for trademark
 * reasons). Keeping them inline also avoids an extra dep.
 */
function FacebookIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
      className={className}
    >
      <path d="M13.5 21v-7.5h2.52l.38-2.93H13.5V8.7c0-.85.24-1.43 1.45-1.43h1.55V4.66c-.27-.04-1.19-.12-2.26-.12-2.24 0-3.78 1.37-3.78 3.88v2.16H8v2.93h2.46V21h3.04Z" />
    </svg>
  );
}

function InstagramIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
    >
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** TikTok glyph (lucide-react has no TikTok icon either). */
function TikTokIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
      className={className}
    >
      <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5 20.1a6.34 6.34 0 0 0 10.86-4.43V8.8a8.16 8.16 0 0 0 4.77 1.52V6.87a4.85 4.85 0 0 1-1.04-.18Z" />
    </svg>
  );
}

const SOCIAL_ICONS: Record<string, React.FC<{ className?: string }>> = {
  fb: FacebookIcon,
  ig: InstagramIcon,
  tt: TikTokIcon,
};

export function Footer() {
  return (
    <footer className="bg-white text-ink-900">
      <div className="mx-auto max-w-[var(--container-page)] px-6 py-12 md:py-16">
        <div className="grid gap-10 md:grid-cols-12 md:gap-12">
          <div className="md:col-span-4">
            <div className="flex items-center gap-3 sm:gap-4">
              <Link href="/" aria-label="Svet Akcija — početna" className="inline-block shrink-0">
                <Image
                  src="/logo.jpeg"
                  alt="Svet Akcija"
                  width={1600}
                  height={382}
                  className="h-auto w-[160px] object-contain min-[390px]:w-[180px] md:w-[328px] md:max-w-[30vw]"
                />
              </Link>

              <div>
                <ul className="flex items-center gap-2">
                  {socials.map((s) => {
                    const Icon = SOCIAL_ICONS[s.id] ?? FacebookIcon;
                    return (
                      <li key={s.id}>
                        <Link
                          href={s.href}
                          target="_blank"
                          rel="noreferrer"
                          aria-label={s.label}
                          className="inline-flex size-10 items-center justify-center rounded-full bg-muted-bg text-ink-700 transition hover:bg-brand-blue hover:text-white"
                        >
                          <Icon className="size-4" />
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
                <h3 className="font-display text-sm tracking-wide text-ink-900">{col.title}</h3>
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
                  className="inline-flex h-8 items-center rounded-md border border-border bg-muted-bg px-3 font-mono text-[11px] tracking-wide text-ink-700 transition hover:border-brand-blue hover:text-brand-blue"
                >
                  {p.label}
                </Link>
              ))}
            </Marquee>
          </div>
        </div>
      </div>

    </footer>
  );
}
