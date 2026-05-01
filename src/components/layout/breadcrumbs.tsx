/**
 * Breadcrumbs — JSON-LD friendly trail used by listing & PDP pages.
 * Last item renders as the current page (no link, aria-current).
 */
import Link from "next/link";
import { ChevronRight, Home } from "lucide-react";
import { cn } from "@/lib/utils";

export interface Crumb {
  label: string;
  href?: string;
}

export function Breadcrumbs({
  trail,
  className,
}: {
  trail: Crumb[];
  className?: string;
}) {
  const items: Crumb[] = [{ label: "Početna", href: "/" }, ...trail];
  return (
    <nav
      aria-label="Putanja"
      className={cn("text-xs text-ink-500", className)}
    >
      <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
        {items.map((c, i) => {
          const isLast = i === items.length - 1;
          return (
            <li key={`${c.label}-${i}`} className="inline-flex items-center gap-1.5">
              {i > 0 ? (
                <ChevronRight className="size-3 text-ink-300" aria-hidden />
              ) : null}
              {isLast || !c.href ? (
                <span
                  aria-current={isLast ? "page" : undefined}
                  className="text-ink-700"
                >
                  {i === 0 ? (
                    <Home className="size-3.5" aria-label={c.label} />
                  ) : (
                    c.label
                  )}
                </span>
              ) : (
                <Link
                  href={c.href}
                  className="hover:text-walnut focus-visible:ring-walnut/40 rounded transition focus-visible:ring-2 focus-visible:outline-none"
                >
                  {i === 0 ? (
                    <Home className="size-3.5" aria-label={c.label} />
                  ) : (
                    c.label
                  )}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
