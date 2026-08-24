"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { ChevronLeft, ChevronRight, Menu } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import type { NavNode } from "@/data/site";
import { getPromoTabPresentation } from "@/data/campaign-icons";
import { cn } from "@/lib/utils";
import { BRAND } from "@/lib/brand";
import type { Tab } from "@/types";
import { BrandLogo } from "./brand-logo";
import { getCategoryMenuAction } from "./category-menu-action";
import { getCategoryMenuImage } from "./category-menu-image";
import { CategoryMenuGrid } from "./category-menu-grid";

interface Crumb {
  label: string;
  href?: string;
  nodes: NavNode[];
}

const promoMenuIconImageClassByKey = {
  "ogranicena-ponuda": "h-8 w-12",
  "niske-cene-pod-zastitom": "h-8 w-12",
} as const;

export function DesktopMenu({
  tabs,
  categories,
}: {
  tabs: Tab[];
  categories: NavNode[];
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [stack, setStack] = useState<Crumb[]>([
    { label: "Sve kategorije", nodes: categories },
  ]);

  const current = stack[stack.length - 1];

  const resetStack = () =>
    setStack([{ label: "Sve kategorije", nodes: categories }]);
  const close = () => {
    setOpen(false);
    setTimeout(resetStack, 200);
  };
  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      setTimeout(resetStack, 200);
    }
  };
  const enter = (node: NavNode) => {
    if (node.children?.length) {
      setStack((s) => [
        ...s,
        { label: node.label, href: node.href, nodes: node.children! },
      ]);
    }
  };
  const back = () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetTrigger
        aria-label="Otvori kategorije"
        className="hidden items-center gap-2 rounded-full px-3 py-2 text-[15px] font-semibold text-brand-blue transition hover:bg-brand-blue/10 focus-visible:ring-2 focus-visible:ring-brand-blue/40 focus-visible:outline-none md:inline-flex"
      >
        <Menu className="size-4" aria-hidden />
        Meni
      </SheetTrigger>
      <SheetContent
        side="left"
        className="!h-[100dvh] !w-[min(92vw,410px)] !max-w-none gap-0 overflow-hidden border-r border-border bg-white p-0 shadow-xl sm:!max-w-none [&_[data-slot=sheet-close]]:top-4 [&_[data-slot=sheet-close]]:right-4 [&_[data-slot=sheet-close]]:text-ink-700 [&_[data-slot=sheet-close]]:hover:bg-muted-bg [&_[data-slot=sheet-close]]:hover:text-brand-blue"
      >
        <SheetHeader className="shrink-0 border-b border-border bg-white px-5 py-4 sm:px-6">
          <div className="flex min-h-10 items-center pr-12">
            <Link
              href="/"
              aria-label={`${BRAND.name} - početna`}
              onClick={close}
            >
              <BrandLogo className="w-[211px]" />
            </Link>
            <SheetTitle className="sr-only">Meni</SheetTitle>
          </div>
        </SheetHeader>

        <nav
          aria-label="Kategorije proizvoda"
          className="min-h-0 flex-1 overflow-y-auto"
        >
          {stack.length > 1 ? (
            <div className="border-b border-border">
              <button
                type="button"
                onClick={back}
                className="flex min-h-13 w-full items-center gap-3 py-3 pr-5 pl-[4.6rem] text-left text-sm font-semibold whitespace-nowrap text-brand-blue transition hover:bg-muted-bg focus-visible:ring-2 focus-visible:ring-brand-blue/35 focus-visible:outline-none sm:pr-6 sm:pl-[4.85rem]"
              >
                <ChevronLeft className="size-4 shrink-0" aria-hidden />
                <span>Povratak na glavni meni</span>
              </button>
            </div>
          ) : null}

          {current.href ? (
            <Link
              href={current.href}
              onClick={close}
              aria-label={`Pogledaj sve iz kategorije ${current.label}`}
              className="flex min-h-14 items-center border-b border-border py-4 pr-5 pl-[6.1rem] text-[15px] font-semibold text-ink-900 transition hover:bg-muted-bg hover:text-brand-blue focus-visible:ring-2 focus-visible:ring-brand-blue/35 focus-visible:outline-none sm:pr-6 sm:pl-[6.6rem]"
            >
              Pogledaj sve
            </Link>
          ) : null}

          {stack.length === 1 ? (
            <CategoryMenuGrid
              categories={current.nodes}
              onEnter={enter}
              onNavigate={close}
            />
          ) : (
            <ul className="divide-y divide-border">
              {current.nodes.map((node) => {
                const isActive = pathname === node.href;
                const opensSubmenu = getCategoryMenuAction(node) === "submenu";
                const categoryImageUrl = getCategoryMenuImage(node);
                return (
                  <li
                    key={node.href}
                    className="min-h-18 transition hover:bg-muted-bg"
                  >
                    {opensSubmenu ? (
                      <button
                        type="button"
                        onClick={() => enter(node)}
                        className={cn(
                          "flex min-h-18 w-full min-w-0 items-center justify-between gap-3 px-5 py-2.5 text-left text-[15px] leading-snug font-medium text-ink-900 transition focus-visible:ring-2 focus-visible:ring-brand-blue/35 focus-visible:outline-none sm:px-6",
                          isActive && "font-semibold text-brand-blue",
                        )}
                      >
                        <span className="flex min-w-0 items-center gap-3">
                          <span className="relative h-12 w-[4.35rem] shrink-0 overflow-hidden rounded-md bg-muted-bg ring-1 ring-border/60">
                            <Image
                              src={categoryImageUrl}
                              alt=""
                              fill
                              sizes="70px"
                              className="object-cover"
                            />
                          </span>
                          <span className="min-w-0 break-words">
                            {node.label}
                          </span>
                        </span>
                        <ChevronRight
                          className="size-4 shrink-0 text-ink-500"
                          aria-hidden
                        />
                      </button>
                    ) : (
                      <Link
                        href={node.href}
                        onClick={close}
                        className={cn(
                          "flex min-h-18 w-full min-w-0 items-center justify-between gap-3 px-5 py-2.5 text-[15px] leading-snug font-medium break-words text-ink-900 transition focus-visible:ring-2 focus-visible:ring-brand-blue/35 focus-visible:outline-none sm:px-6",
                          isActive && "font-semibold text-brand-blue",
                        )}
                      >
                        <span className="flex min-w-0 items-center gap-3">
                          <span className="relative h-12 w-[4.35rem] shrink-0 overflow-hidden rounded-md bg-muted-bg ring-1 ring-border/60">
                            <Image
                              src={categoryImageUrl}
                              alt=""
                              fill
                              sizes="70px"
                              className="object-cover"
                            />
                          </span>
                          <span className="min-w-0 break-words">
                            {node.label}
                          </span>
                        </span>
                        <ChevronRight
                          className="size-4 shrink-0 text-ink-300"
                          aria-hidden
                        />
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {stack.length === 1 ? (
            <ul className="mt-4 border-t border-border">
              {tabs.map((tab) => {
                const promoTab = getPromoTabPresentation(tab);
                const isActive = pathname === promoTab.href;
                const iconAsset = promoTab.iconAsset;
                const iconImageClass = promoTab.iconKey
                  ? promoMenuIconImageClassByKey[
                      promoTab.iconKey as keyof typeof promoMenuIconImageClassByKey
                    ]
                  : undefined;
                return (
                  <li key={tab.id} className="border-b border-border">
                    <Link
                      href={promoTab.href}
                      onClick={close}
                      className={cn(
                        "flex min-h-13 items-center justify-between gap-4 px-5 py-3.5 text-sm font-medium text-ink-700 transition hover:bg-muted-bg hover:text-brand-blue focus-visible:ring-2 focus-visible:ring-brand-blue/35 focus-visible:outline-none sm:px-6",
                        isActive && "font-semibold text-brand-blue",
                      )}
                    >
                      <span className="flex min-w-0 items-center gap-3">
                        {iconAsset ? (
                          <span className="flex h-6 w-12 shrink-0 items-center justify-center">
                            <Image
                              src={iconAsset.url}
                              alt=""
                              width={iconAsset.width ?? 80}
                              height={iconAsset.height ?? 80}
                              unoptimized={iconAsset.url.endsWith(".svg")}
                              className={cn(
                                "h-6 w-6 object-contain",
                                iconImageClass,
                              )}
                            />
                          </span>
                        ) : null}
                        <span className="min-w-0 break-words">
                          {promoTab.label}
                        </span>
                      </span>
                      <ChevronRight
                        className="size-4 shrink-0 text-ink-300"
                        aria-hidden
                      />
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </nav>
      </SheetContent>
    </Sheet>
  );
}
