"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, ChevronRight, ChevronLeft, User2, Search } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { motion, AnimatePresence } from "framer-motion";
import { primaryNav, headerTabs, type NavNode } from "@/data/site";
import { cn } from "@/lib/utils";
import { BrandLogo } from "./brand-logo";
import { InstantSearch } from "./instant-search";

interface Crumb {
  label: string;
  href?: string;
  nodes: NavNode[];
}

export function MobileNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [stack, setStack] = useState<Crumb[]>([{ label: "Sve kategorije", nodes: primaryNav }]);
  const [searchOpen, setSearchOpen] = useState(false);

  const current = stack[stack.length - 1];

  const enter = (node: NavNode) => {
    if (node.children?.length) {
      setStack((s) => [...s, { label: node.label, href: node.href, nodes: node.children! }]);
    }
  };
  const back = () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));

  const close = () => {
    setOpen(false);
    setSearchOpen(false);
    setTimeout(() => setStack([{ label: "Sve kategorije", nodes: primaryNav }]), 250);
  };

  return (
    <div className="flex items-center gap-1 md:hidden">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger
          aria-label="Otvori navigaciju"
          className="hover:bg-muted-bg inline-flex size-10 items-center justify-center rounded-full text-ink-700 hover:text-ink-900"
        >
          <Menu className="size-5" aria-hidden />
        </SheetTrigger>
        <SheetContent
          side="left"
          className="h-[100dvh] w-[94vw] max-w-[430px] gap-0 overflow-hidden border-r border-border bg-white p-0 [&_[data-slot=sheet-close]]:top-4 [&_[data-slot=sheet-close]]:right-4 [&_[data-slot=sheet-close]]:text-ink-700 [&_[data-slot=sheet-close]]:hover:bg-muted-bg [&_[data-slot=sheet-close]]:hover:text-brand-blue"
        >
          <SheetHeader className="shrink-0 border-b border-border bg-white px-4 py-3">
            <div className="flex min-h-10 items-center pr-12">
              <Link href="/" aria-label="Svet Akcija - početna" onClick={close}>
                <BrandLogo className="w-[140px]" />
              </Link>
              <SheetTitle className="sr-only">Meni</SheetTitle>
            </div>
          </SheetHeader>
          <div className="relative flex-1 overflow-hidden">
            {stack.length > 1 ? (
              <div className="border-b border-border">
                <button
                  type="button"
                  onClick={back}
                  aria-label="Nazad"
                  className="flex min-h-13 w-full items-center gap-3 px-4 py-3 text-left text-sm font-semibold text-brand-blue transition hover:bg-muted-bg focus-visible:ring-2 focus-visible:ring-brand-blue/35 focus-visible:outline-none"
                >
                  <ChevronLeft className="size-4 shrink-0" aria-hidden />
                  <span className="min-w-0 break-words">{current.label}</span>
                </button>
              </div>
            ) : null}
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={stack.length + ":" + current.label}
                initial={{ x: 24, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: -24, opacity: 0 }}
                transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                className="h-full overflow-y-auto"
              >
                {current.href ? (
                  <Link
                    href={current.href}
                    onClick={close}
                    className="flex min-h-14 items-center border-b border-border px-4 py-4 text-[15px] font-semibold text-ink-900 transition hover:bg-muted-bg hover:text-brand-blue focus-visible:ring-2 focus-visible:ring-brand-blue/35 focus-visible:outline-none"
                  >
                    Pogledaj sve
                  </Link>
                ) : null}

                <ul className="divide-y divide-border">
                  {current.nodes.map((node) => {
                    const isActive = pathname === node.href;
                    const hasChildren = !!node.children?.length;
                    return (
                      <li key={node.href} className="flex min-h-14 items-stretch transition hover:bg-muted-bg">
                        <Link
                          href={node.href}
                          onClick={close}
                          className={cn(
                            "flex min-w-0 flex-1 items-center px-4 py-3.5 text-[15px] leading-snug font-medium break-words text-ink-900 transition focus-visible:ring-2 focus-visible:ring-brand-blue/35 focus-visible:outline-none",
                            isActive && "font-semibold text-brand-blue",
                          )}
                        >
                          {node.label}
                        </Link>
                        {hasChildren ? (
                          <button
                            type="button"
                            onClick={() => enter(node)}
                            aria-label={`Otvori ${node.label}`}
                            className="flex w-13 shrink-0 items-center justify-center text-ink-500 transition hover:bg-brand-blue/5 hover:text-brand-blue focus-visible:ring-2 focus-visible:ring-brand-blue/35 focus-visible:outline-none"
                          >
                            <ChevronRight className="size-4" aria-hidden />
                          </button>
                        ) : (
                          <span
                            className="flex w-13 shrink-0 items-center justify-center text-ink-300"
                            aria-hidden
                          >
                            <ChevronRight className="size-4" />
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>

                {stack.length === 1 ? (
                  <ul className="mt-3 border-t border-border">
                    {headerTabs.map((t) => {
                      const isActive = pathname === t.href;
                      return (
                        <li key={t.id} className="border-b border-border">
                          <Link
                            href={t.href}
                            onClick={close}
                            className={cn(
                              "flex min-h-12 items-center justify-between gap-4 px-4 py-3 text-sm font-medium text-ink-700 transition hover:bg-muted-bg hover:text-brand-blue focus-visible:ring-2 focus-visible:ring-brand-blue/35 focus-visible:outline-none",
                              isActive && "font-semibold text-brand-blue",
                            )}
                          >
                            <span className="min-w-0 break-words">{t.label}</span>
                            <ChevronRight className="size-4 shrink-0 text-ink-300" aria-hidden />
                          </Link>
                        </li>
                      );
                    })}
                    <li className="border-b border-border">
                      <Link
                        href="/nalog"
                        onClick={close}
                        className="flex min-h-12 items-center justify-between gap-4 px-4 py-3 text-sm font-medium text-ink-700 transition hover:bg-muted-bg hover:text-brand-blue focus-visible:ring-2 focus-visible:ring-brand-blue/35 focus-visible:outline-none"
                      >
                        <span className="inline-flex min-w-0 items-center gap-2 break-words">
                          <User2 className="size-4 shrink-0" aria-hidden />
                          Moj nalog
                        </span>
                        <ChevronRight className="size-4 shrink-0 text-ink-300" aria-hidden />
                      </Link>
                    </li>
                  </ul>
                ) : null}
              </motion.div>
            </AnimatePresence>
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={searchOpen} onOpenChange={setSearchOpen}>
        <SheetTrigger
          aria-label="Pretraži"
          className="hover:bg-muted-bg inline-flex size-10 items-center justify-center rounded-full text-ink-700 hover:text-ink-900"
        >
          <Search className="size-5" aria-hidden />
        </SheetTrigger>
        {/*
         * Fullscreen mobile search overlay (per spec: search must take the
         * whole screen). The Sheet is forced to 100vh + full width via
         * `w-screen h-[100dvh]` and side="top".
         */}
        <SheetContent
          side="top"
          className="!inset-0 !h-[100dvh] !w-screen !max-w-none gap-0 overflow-hidden rounded-none border-0 p-0"
        >
          <SheetHeader className="shrink-0 border-b border-border bg-surface px-4 py-3">
            <SheetTitle className="font-display text-base text-ink-900">
              Pretraga
            </SheetTitle>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto bg-surface p-4">
            <InstantSearch
              presentation="inline"
              onNavigate={() => setSearchOpen(false)}
            />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
