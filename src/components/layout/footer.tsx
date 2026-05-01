import Link from "next/link";
import { footerColumns, paymentMethods, socials } from "@/data/site";
import { Marquee } from "@/components/motion/marquee";

const socialIcon = (id: string) => {
  const label =
    id === "fb" ? "Fb" : id === "ig" ? "Ig" : id === "tt" ? "TT" : id;
  return <span className="font-mono text-[11px] tracking-wider">{label}</span>;
};

export function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer className="bg-ink-900 text-canvas">
      <div className="mx-auto max-w-[var(--container-page)] px-6 py-16">
        <div className="grid gap-12 md:grid-cols-12">
          <div className="md:col-span-4">
            <Link
              href="/"
              className="font-display text-2xl leading-none tracking-tight"
              aria-label="Svet povoljnih cena — početna"
            >
              Svet <span className="text-sand">povoljnih</span> cena
            </Link>
            <p className="mt-4 max-w-xs text-sm text-canvas/70">
              Premium nameštaj po povoljnim cenama. Brza isporuka, montaža u glavnim gradovima,
              kuratirane kolekcije.
            </p>

            <div className="mt-8">
              <p className="font-mono text-[11px] tracking-[0.2em] text-canvas/60 uppercase">
                Pratite nas
              </p>
              <ul className="mt-3 flex items-center gap-2">
                {socials.map((s) => (
                  <li key={s.id}>
                    <Link
                      href={s.href}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={s.label}
                      className="inline-flex size-9 items-center justify-center rounded-full bg-canvas/10 text-canvas transition hover:bg-canvas/20"
                    >
                      {socialIcon(s.id)}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <nav
            aria-label="Footer navigacija"
            className="grid gap-8 sm:grid-cols-2 md:col-span-8 md:grid-cols-4"
          >
            {footerColumns.map((col) => (
              <div key={col.title}>
                <h3 className="font-display text-sm tracking-wide text-sand">{col.title}</h3>
                <ul className="mt-4 space-y-2 text-sm text-canvas/80">
                  {col.links.map((l) => (
                    <li key={l.href}>
                      <Link
                        href={l.href}
                        className="transition hover:text-canvas"
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

      <div className="border-t border-canvas/10">
        <div className="mx-auto max-w-[var(--container-page)] px-6 py-5">
          <div className="flex items-center gap-4">
            <span className="font-mono text-[10px] tracking-[0.2em] text-canvas/50 shrink-0 uppercase">
              Načini plaćanja
            </span>
            <Marquee durationSec={36} className="flex-1">
              {paymentMethods.map((p) => (
                <Link
                  key={p.id}
                  href={p.href}
                  aria-label={p.label}
                  className="inline-flex h-8 items-center rounded-md border border-canvas/20 bg-canvas/5 px-3 font-mono text-[11px] tracking-wide text-canvas/80 transition hover:border-canvas/40 hover:text-canvas"
                >
                  {p.label}
                </Link>
              ))}
            </Marquee>
          </div>
        </div>
      </div>

      <div className="border-t border-canvas/10">
        <div className="mx-auto flex max-w-[var(--container-page)] flex-col gap-4 px-6 py-6 text-xs text-canvas/60 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-wrap items-center gap-4">
            <span>© {year} Svet povoljnih cena</span>
            <Link href="/uslovi-kupovine" className="hover:text-canvas">
              Uslovi kupovine
            </Link>
            <Link href="/politika-privatnosti" className="hover:text-canvas">
              Privatnost
            </Link>
            <Link href="/kontakt" className="hover:text-canvas">
              Kontakt
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
