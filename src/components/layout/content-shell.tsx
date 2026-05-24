/**
 * Editorial layout primitives for static content pages (Phase 1G).
 * - `ContentHero`: eyebrow + title + lead paragraph, generous whitespace.
 * - `ContentBody`: 72ch reading column with prose styling.
 * - `ContentSection`: titled block inside body, scroll-anchored.
 * - `ContentGrid`: optional two-column (TOC / aside) layout.
 *
 * No state, no client deps — safe to render as RSC.
 */
import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export function ContentHero({
  title,
  lead,
  meta,
}: {
  eyebrow?: string;
  title: string;
  lead?: string;
  meta?: ReactNode;
}) {
  return (
    <header className="bg-muted-bg/60 border-border/60 border-b">
      <div className="mx-auto w-full max-w-[var(--container-content)] px-6 py-16 md:py-24">
        <h1 className="font-display text-4xl font-bold text-ink-900 md:text-6xl">
          {title}
        </h1>
        {lead ? (
          <p className="mt-5 max-w-[60ch] text-justify text-lg leading-relaxed text-ink-700 md:text-xl">
            {lead}
          </p>
        ) : null}
        {meta ? (
          <div className="mt-8 font-mono text-xs tracking-wide text-ink-500 uppercase">
            {meta}
          </div>
        ) : null}
      </div>
    </header>
  );
}

export function ContentBody({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mx-auto w-full max-w-[72ch] px-6 py-16 text-ink-700 md:py-24",
        // Local prose-like rules — we don't ship @tailwindcss/typography yet.
        "[&_p]:mt-4 [&_p]:text-justify [&_p]:leading-relaxed",
        "[&_ul]:mt-4 [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5",
        "[&_ol]:mt-4 [&_ol]:list-decimal [&_ol]:space-y-2 [&_ol]:pl-5",
        "[&_a]:text-walnut [&_a]:underline [&_a]:underline-offset-4 hover:[&_a]:opacity-80",
        "[&_strong]:text-ink-900 [&_strong]:font-semibold",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function ContentSection({
  id,
  title,
  children,
}: {
  id?: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-28 pt-10 first:pt-0">
      <h2 className="font-display text-2xl font-bold text-brand-blue md:text-3xl">{title}</h2>
      <div className="mt-2">{children}</div>
    </section>
  );
}

/** Hub link card for /servis. */
export function HubCard({
  href,
  title,
  description,
}: {
  href: string;
  title: string;
  description: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "bg-surface ring-border/60 group relative flex flex-col gap-2 rounded-2xl p-6 ring-1 transition",
        "hover:ring-walnut/40 hover:shadow-soft-3 focus-visible:ring-walnut/40 focus-visible:ring-2 focus-visible:outline-none",
      )}
    >
      <h3 className="font-display text-xl text-ink-900">{title}</h3>
      <p className="text-sm text-ink-700">{description}</p>
      <span className="text-walnut mt-2 inline-flex items-center gap-1 text-sm font-medium">
        Otvori
        <ChevronRight
          className="size-4 transition group-hover:translate-x-0.5"
          aria-hidden
        />
      </span>
    </Link>
  );
}
