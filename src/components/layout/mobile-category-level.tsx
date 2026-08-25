import Image from "next/image";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { NavNode } from "@/data/site";
import { cn } from "@/lib/utils";
import { getCategoryMenuAction } from "./category-menu-action";
import { getCategoryMenuImage } from "./category-menu-image";

export function MobileCategoryLevel({
  category,
  pathname,
  onBack,
  onEnter,
  onNavigate,
}: {
  category: Pick<NavNode, "label" | "href" | "children">;
  pathname: string;
  onBack: () => void;
  onEnter: (node: NavNode) => void;
  onNavigate: () => void;
}) {
  const children = category.children ?? [];

  return (
    <div
      data-slot="mobile-category-level"
      className="flex min-h-0 flex-1 flex-col bg-white"
    >
      <div className="flex min-h-12 shrink-0 items-center gap-3 border-b border-border px-2.5">
        <button
          type="button"
          onClick={onBack}
          aria-label="Nazad"
          className="inline-flex size-9 shrink-0 items-center justify-center rounded-full text-ink-300 transition hover:bg-muted-bg hover:text-ink-900 focus-visible:ring-2 focus-visible:ring-brand-blue/35 focus-visible:outline-none"
        >
          <ChevronLeft className="size-5" aria-hidden />
        </button>
        <h2 className="min-w-0 truncate text-sm font-bold tracking-[0.015em] text-ink-500 uppercase">
          {category.label}
        </h2>
      </div>

      <Link
        href={category.href}
        onClick={onNavigate}
        aria-label={`Pogledaj sve iz kategorije ${category.label}`}
        className="flex min-h-11 shrink-0 items-center justify-between border-b border-border py-2 pr-3 pl-[3.875rem] text-xs font-semibold text-ink-500 transition hover:bg-muted-bg hover:text-brand-blue focus-visible:ring-2 focus-visible:ring-brand-blue/35 focus-visible:outline-none"
      >
        <span>Pogledaj sve</span>
        <ChevronRight className="size-4 shrink-0 text-ink-300" aria-hidden />
      </Link>

      <ul className="min-h-0 flex-1 divide-y divide-border overflow-y-auto overscroll-contain pb-[max(env(safe-area-inset-bottom),0.75rem)]">
        {children.map((node) => {
          const isActive = pathname === node.href;
          const opensSubmenu = getCategoryMenuAction(node) === "submenu";
          const rowContent = (
            <>
              <span className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
                <span className="relative h-8 w-11 shrink-0 overflow-hidden rounded-md bg-white ring-1 ring-border/60">
                  <Image
                    src={getCategoryMenuImage(node)}
                    alt=""
                    fill
                    sizes="44px"
                    className="object-contain"
                  />
                </span>
                <span className="min-w-0 truncate whitespace-nowrap">
                  {node.label}
                </span>
              </span>
              <ChevronRight
                className="size-4 shrink-0 text-ink-300"
                aria-hidden
              />
            </>
          );

          return (
            <li key={node.href} className="min-h-11">
              {opensSubmenu ? (
                <button
                  type="button"
                  onClick={() => onEnter(node)}
                  className="flex min-h-11 w-full min-w-0 items-center justify-between gap-2 px-2.5 py-1.5 text-left text-xs leading-snug font-semibold text-ink-700 transition hover:bg-muted-bg focus-visible:ring-2 focus-visible:ring-brand-blue/35 focus-visible:outline-none"
                >
                  {rowContent}
                </button>
              ) : (
                <Link
                  href={node.href}
                  onClick={onNavigate}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "flex min-h-11 w-full min-w-0 items-center justify-between gap-2 px-2.5 py-1.5 text-xs leading-snug font-semibold text-ink-700 transition hover:bg-muted-bg focus-visible:ring-2 focus-visible:ring-brand-blue/35 focus-visible:outline-none",
                    isActive && "text-brand-blue",
                  )}
                >
                  {rowContent}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
