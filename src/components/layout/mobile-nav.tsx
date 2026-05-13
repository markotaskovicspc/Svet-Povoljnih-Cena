"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Crown,
  Home,
  Hourglass,
  Menu,
  Percent,
  Search,
  ShieldCheck,
  Sparkles,
  User2,
  X,
} from "lucide-react";
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

const categoryTiles = [
  {
    label: "Bašta",
    href: "/k/namestaj/bastenski-namestaj",
    imageUrl: "https://images.unsplash.com/photo-1600210491892-03d54c0aaf87?auto=format&fit=crop&w=320&h=210&q=80",
  },
  {
    label: "Kućni aparati",
    href: "/k/kucni-aparati",
    imageUrl: "https://images.unsplash.com/photo-1556911220-bff31c812dba?auto=format&fit=crop&w=320&h=210&q=80",
  },
  {
    label: "Dnevna soba",
    href: "/k/namestaj/dnevna-soba",
    imageUrl: "https://images.unsplash.com/photo-1555041469-a586c61ea9bc?auto=format&fit=crop&w=320&h=210&q=80",
  },
  {
    label: "Spavaća soba",
    href: "/k/namestaj/spavaca-soba",
    imageUrl: "https://images.unsplash.com/photo-1505693314120-0d443867891c?auto=format&fit=crop&w=320&h=210&q=80",
  },
  {
    label: "Trpezarija",
    href: "/k/namestaj/trpezarija",
    imageUrl: "https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?auto=format&fit=crop&w=320&h=210&q=80",
  },
  {
    label: "Radna soba",
    href: "/k/namestaj/kancelarija",
    imageUrl: "https://images.unsplash.com/photo-1518455027359-f3f8164ba6bd?auto=format&fit=crop&w=320&h=210&q=80",
  },
  {
    label: "Predsoblje",
    href: "/k/namestaj/predsoblje",
    imageUrl: "https://images.unsplash.com/photo-1551298370-9d3d53740c72?auto=format&fit=crop&w=320&h=210&q=80",
  },
  {
    label: "Rasveta",
    href: "/k/sve-za-kucu/rasveta",
    imageUrl: "https://images.unsplash.com/photo-1513506003901-1e6a229e2d15?auto=format&fit=crop&w=320&h=210&q=80",
  },
  {
    label: "Kupatilo",
    href: "/k/sve-za-kucu/kupatilo",
    imageUrl: "https://images.unsplash.com/photo-1552321554-5fefe8c9ef14?auto=format&fit=crop&w=320&h=210&q=80",
  },
  {
    label: "Dekoracija",
    href: "/k/sve-za-kucu/dekoracija",
    imageUrl: "https://images.unsplash.com/photo-1513519245088-0e12902e5a38?auto=format&fit=crop&w=320&h=210&q=80",
  },
  {
    label: "Tepisi",
    href: "/k/sve-za-kucu/tepisi",
    imageUrl: "https://images.unsplash.com/photo-1600166898405-da9535204843?auto=format&fit=crop&w=320&h=210&q=80",
  },
  {
    label: "Koferi",
    href: "/k/moda-i-putovanja/koferi",
    imageUrl: "https://images.unsplash.com/photo-1553531384-411a247ccd73?auto=format&fit=crop&w=320&h=210&q=80",
  },
] as const;

const tabIcons = {
  "mesecna-akcija": Percent,
  "nedeljna-akcija": CalendarDays,
  "heroji-meseca": Crown,
  "ogranicena-ponuda": Hourglass,
  "sve-do-999": ShieldCheck,
  "specijalne-ponude": Sparkles,
} as const;

const tabStyles = [
  "bg-action text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.18)]",
  "bg-success text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.18)]",
  "bg-brand-blue-700 text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.14)]",
  "bg-info text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.16)]",
  "bg-warning text-ink-900 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.22)]",
  "bg-olive text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.18)]",
];

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
          showCloseButton={false}
          className="!inset-0 !h-[100dvh] !w-screen !max-w-none gap-0 overflow-hidden border-0 bg-white p-0 sm:!max-w-none"
        >
          <SheetHeader className="shrink-0 bg-brand-blue px-4 pt-[max(env(safe-area-inset-top),0.75rem)] pb-3 text-white">
            <div className="grid min-h-11 grid-cols-[2.5rem_1fr_auto] items-center gap-3">
              <button
                type="button"
                onClick={close}
                aria-label="Zatvori meni"
                className="inline-flex size-10 items-center justify-center rounded-full text-white/85 transition hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:outline-none"
              >
                <X className="size-5" aria-hidden />
              </button>
              <Link
                href="/"
                aria-label="Svet Akcija - početna"
                onClick={close}
                className="justify-self-center"
              >
                <BrandLogo className="w-[142px]" imageClassName="brightness-0 invert" />
              </Link>
              <div className="flex items-center justify-end gap-1">
                <Link
                  href="/"
                  onClick={close}
                  aria-label="Početna"
                  className="inline-flex size-10 items-center justify-center rounded-full text-white/80 transition hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:outline-none"
                >
                  <Home className="size-5" aria-hidden />
                </Link>
                <Link
                  href="/nalog"
                  onClick={close}
                  aria-label="Moj nalog"
                  className="inline-flex size-10 items-center justify-center rounded-full text-white/80 transition hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:outline-none"
                >
                  <User2 className="size-5" aria-hidden />
                </Link>
              </div>
              <SheetTitle className="sr-only">Meni</SheetTitle>
            </div>
          </SheetHeader>

          <div className="shrink-0 border-b border-border bg-muted-bg px-4 py-3 shadow-[0_3px_10px_rgba(26,23,20,0.12)]">
            <InstantSearch
              presentation="inline"
              onNavigate={close}
              className="[&_kbd]:hidden [&_input]:bg-white [&_input]:pr-4 [&_input]:placeholder:text-ink-300"
            />
          </div>

          <div className="relative flex-1 overflow-hidden bg-white">
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
                {stack.length === 1 ? (
                  <>
                    <div className="px-4 pt-5 pb-4">
                      <ul className="grid grid-cols-3 gap-x-3 gap-y-4 min-[390px]:grid-cols-4">
                        {categoryTiles.map((tile) => (
                          <li key={tile.href}>
                            <Link
                              href={tile.href}
                              onClick={close}
                              className="group block rounded-md focus-visible:ring-2 focus-visible:ring-brand-blue/35 focus-visible:outline-none"
                            >
                              <span className="relative block aspect-[1.42] overflow-hidden rounded-md bg-muted-bg">
                                <Image
                                  src={tile.imageUrl}
                                  alt=""
                                  fill
                                  sizes="(max-width: 389px) 28vw, 22vw"
                                  className="object-cover transition duration-200 group-hover:scale-105"
                                />
                              </span>
                              <span className="mt-2 block min-h-8 text-center text-[10px] leading-tight font-bold tracking-[0.02em] text-ink-700 uppercase">
                                {tile.label}
                              </span>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div className="bg-brand-blue px-4 py-5">
                      <ul className="grid grid-cols-2 gap-3">
                        {headerTabs.map((t, index) => {
                          const isActive = pathname === t.href;
                          const Icon = tabIcons[t.id as keyof typeof tabIcons] ?? Sparkles;
                          return (
                            <li key={t.id}>
                              <Link
                                href={t.href}
                                onClick={close}
                                className={cn(
                                  "flex min-h-14 items-center gap-3 rounded-md px-3 py-3 text-sm font-semibold transition focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none",
                                  tabStyles[index % tabStyles.length],
                                  isActive && "ring-2 ring-white/75",
                                )}
                              >
                                <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-current/20 bg-white/10">
                                  <Icon className="size-4" aria-hidden />
                                </span>
                                <span className="min-w-0 leading-tight break-words">{t.label}</span>
                              </Link>
                            </li>
                          );
                        })}
                        <li>
                          <Link
                            href="/nalog"
                            onClick={close}
                            className="flex min-h-14 items-center gap-3 rounded-md bg-white/10 px-3 py-3 text-sm font-semibold text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.16)] transition hover:bg-white/15 focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none"
                          >
                            <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-white/20 bg-white/10">
                              <User2 className="size-4" aria-hidden />
                            </span>
                            <span className="min-w-0 leading-tight break-words">Moj nalog</span>
                          </Link>
                        </li>
                      </ul>
                    </div>

                    <div className="px-4 py-4">
                      <div className="mb-2 text-xs font-semibold tracking-[0.08em] text-ink-500 uppercase">
                        Sve kategorije
                      </div>
                    </div>
                  </>
                ) : current.href ? (
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

                {stack.length !== 1 ? (
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
