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
import { primaryNav, type NavNode } from "@/data/site";
import { getPromoTabPresentation } from "@/data/campaign-icons";
import { cn } from "@/lib/utils";
import type { Tab } from "@/types";
import { InstantSearch } from "./instant-search";

interface Crumb {
  label: string;
  href?: string;
  nodes: NavNode[];
}

const categoryTileImages: Record<string, string> = {
  Nameštaj: "https://images.unsplash.com/photo-1586023492125-27b2c045efd7?auto=format&fit=crop&w=320&h=210&q=80",
  "Sve za kuću": "https://images.unsplash.com/photo-1513519245088-0e12902e5a38?auto=format&fit=crop&w=320&h=210&q=80",
  "Kućni aparati": "https://images.unsplash.com/photo-1556911220-bff31c812dba?auto=format&fit=crop&w=320&h=210&q=80",
  "Moda i putovanja": "https://images.unsplash.com/photo-1553531384-411a247ccd73?auto=format&fit=crop&w=320&h=210&q=80",
  "Baštenski nameštaj": "https://images.unsplash.com/photo-1600210491892-03d54c0aaf87?auto=format&fit=crop&w=320&h=210&q=80",
  Kancelarija: "https://images.unsplash.com/photo-1518455027359-f3f8164ba6bd?auto=format&fit=crop&w=320&h=210&q=80",
  Trpezarija: "https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?auto=format&fit=crop&w=320&h=210&q=80",
  "Dnevna soba": "https://images.unsplash.com/photo-1555041469-a586c61ea9bc?auto=format&fit=crop&w=320&h=210&q=80",
  Predsoblje: "https://images.unsplash.com/photo-1551298370-9d3d53740c72?auto=format&fit=crop&w=320&h=210&q=80",
  Gejming: "https://images.unsplash.com/photo-1598550476439-6847785fcea6?auto=format&fit=crop&w=320&h=210&q=80",
  "Spavaća soba": "https://images.unsplash.com/photo-1505693314120-0d443867891c?auto=format&fit=crop&w=320&h=210&q=80",
  Bazeni: "https://images.unsplash.com/photo-1572331165267-854da2b10ccc?auto=format&fit=crop&w=320&h=210&q=80",
  Alat: "https://images.unsplash.com/photo-1530124566582-a618bc2615dc?auto=format&fit=crop&w=320&h=210&q=80",
  Rasveta: "https://images.unsplash.com/photo-1513506003901-1e6a229e2d15?auto=format&fit=crop&w=320&h=210&q=80",
  "Čišćenje i održavanje": "https://images.unsplash.com/photo-1563453392212-326f5e854473?auto=format&fit=crop&w=320&h=210&q=80",
  Dekoracija: "https://images.unsplash.com/photo-1513519245088-0e12902e5a38?auto=format&fit=crop&w=320&h=210&q=80",
  Kupatilo: "https://images.unsplash.com/photo-1552321554-5fefe8c9ef14?auto=format&fit=crop&w=320&h=210&q=80",
  Tepisi: "https://images.unsplash.com/photo-1600166898405-da9535204843?auto=format&fit=crop&w=320&h=210&q=80",
  "Kafe aparati": "https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?auto=format&fit=crop&w=320&h=210&q=80",
  "Lepota i nega": "https://images.unsplash.com/photo-1522338242992-e1a54906a8da?auto=format&fit=crop&w=320&h=210&q=80",
  "Hlađenje i grejanje": "https://images.unsplash.com/photo-1567767292278-a4f21aa2d36e?auto=format&fit=crop&w=320&h=210&q=80",
  "Priprema hrane": "https://images.unsplash.com/photo-1556911220-bff31c812dba?auto=format&fit=crop&w=320&h=210&q=80",
  "Kuvanje i pečenje": "https://images.unsplash.com/photo-1556911073-38141963c9e0?auto=format&fit=crop&w=320&h=210&q=80",
  Pegle: "https://images.unsplash.com/photo-1583847268964-b28dc8f51f92?auto=format&fit=crop&w=320&h=210&q=80",
  Usisivači: "https://images.unsplash.com/photo-1558618666-fcd25c85cd64?auto=format&fit=crop&w=320&h=210&q=80",
  "Prečišćivači vazduha": "https://images.unsplash.com/photo-1585338107529-13afc5f02586?auto=format&fit=crop&w=320&h=210&q=80",
  "Aparati za vodu": "https://images.unsplash.com/photo-1559827260-dc66d52bef19?auto=format&fit=crop&w=320&h=210&q=80",
  "Ženske torbe": "https://images.unsplash.com/photo-1590874103328-eac38a683ce7?auto=format&fit=crop&w=320&h=210&q=80",
  "Ženske čarape": "https://images.unsplash.com/photo-1586350977771-b3b0abd50c82?auto=format&fit=crop&w=320&h=210&q=80",
  Aksesoari: "https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?auto=format&fit=crop&w=320&h=210&q=80",
  Koferi: "https://images.unsplash.com/photo-1553531384-411a247ccd73?auto=format&fit=crop&w=320&h=210&q=80",
};

const fallbackCategoryImage =
  "https://images.unsplash.com/photo-1586023492125-27b2c045efd7?auto=format&fit=crop&w=320&h=210&q=80";

const categoryTiles = primaryNav.map((node) => ({
  ...node,
  imageUrl: categoryTileImages[node.label] ?? fallbackCategoryImage,
}));

const tabIcons = {
  "mesecna-akcija": Percent,
  "nedeljna-akcija": CalendarDays,
  "heroji-meseca": Crown,
  "niske-cene-pod-zastitom": ShieldCheck,
  "ogranicena-ponuda": Hourglass,
  "sve-do-999": ShieldCheck,
  "specijalne-ponude": Sparkles,
} as const;

export function MobileNav({ tabs }: { tabs: Tab[] }) {
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
          <SheetHeader className="shrink-0 bg-white px-4 pt-[max(env(safe-area-inset-top),0.75rem)] pb-3 text-brand-blue">
            <div className="grid min-h-11 grid-cols-[2.5rem_1fr_auto] items-center gap-3">
              <button
                type="button"
                onClick={close}
                aria-label="Zatvori meni"
                className="inline-flex size-10 items-center justify-center rounded-full text-ink-700 transition hover:bg-muted-bg hover:text-ink-900 focus-visible:ring-2 focus-visible:ring-brand-blue/35 focus-visible:outline-none"
              >
                <X className="size-5" aria-hidden />
              </button>
              <Link
                href="/"
                aria-label="Svet Akcija - početna"
                onClick={close}
                className="justify-self-center"
              >
                <Image
                  src="/logo.webp"
                  alt="Svet Akcija"
                  width={1600}
                  height={382}
                  priority
                  className="h-auto w-[190px] object-contain min-[390px]:w-[215px]"
                />
              </Link>
              <div className="flex items-center justify-end gap-1">
                <Link
                  href="/"
                  onClick={close}
                  aria-label="Početna"
                  className="inline-flex size-10 items-center justify-center rounded-full text-ink-700 transition hover:bg-muted-bg hover:text-ink-900 focus-visible:ring-2 focus-visible:ring-brand-blue/35 focus-visible:outline-none"
                >
                  <Home className="size-5" aria-hidden />
                </Link>
                <Link
                  href="/nalog"
                  onClick={close}
                  aria-label="Moj nalog"
                  className="inline-flex size-10 items-center justify-center rounded-full text-ink-700 transition hover:bg-muted-bg hover:text-ink-900 focus-visible:ring-2 focus-visible:ring-brand-blue/35 focus-visible:outline-none"
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
                      <ul className="grid grid-cols-2 gap-x-3 gap-y-4">
                        {categoryTiles.map((tile) => (
                          <li key={tile.href}>
                            <button
                              type="button"
                              onClick={() => enter(tile)}
                              className="group block w-full rounded-md text-left focus-visible:ring-2 focus-visible:ring-brand-blue/35 focus-visible:outline-none"
                            >
                              <span className="relative block aspect-[1.42] overflow-hidden rounded-md bg-muted-bg">
                                <Image
                                  src={tile.imageUrl}
                                  alt=""
                                  fill
                                  sizes="45vw"
                                  className="object-cover transition duration-200 group-hover:scale-105"
                                />
                              </span>
                              <span className="mt-2 block min-h-8 text-center text-[10px] leading-tight font-bold tracking-[0.02em] text-ink-700 uppercase">
                                {tile.label}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div className="border-y border-brand-blue/10 bg-brand-blue px-4 py-5">
                      <ul className="grid grid-cols-2 gap-3">
                        {tabs.map((t) => {
                          const promoTab = getPromoTabPresentation(t);
                          const isActive = pathname === promoTab.href;
                          const Icon =
                            tabIcons[(promoTab.iconKey ?? promoTab.id) as keyof typeof tabIcons] ??
                            Sparkles;
                          const iconAsset = promoTab.iconAsset;
                          return (
                            <li key={t.id}>
                              <Link
                                href={promoTab.href}
                                onClick={close}
                                className={cn(
                                  "flex min-h-14 items-center gap-3 rounded-md border border-white/20 bg-white px-3 py-3 text-sm font-semibold text-brand-blue shadow-soft-1 transition hover:bg-brand-blue-50 focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none",
                                  isActive && "ring-2 ring-white/80",
                                )}
                              >
                                <span
                                  className={cn(
                                    "flex size-8 shrink-0 items-center justify-center text-brand-blue",
                                    !iconAsset && "rounded-md bg-brand-blue-50",
                                  )}
                                >
                                  {iconAsset ? (
                                    <Image
                                      src={iconAsset.url}
                                      alt=""
                                      width={iconAsset.width ?? 80}
                                      height={iconAsset.height ?? 80}
                                      unoptimized={iconAsset.url.endsWith(".svg")}
                                      className="h-8 w-8 object-contain"
                                    />
                                  ) : (
                                    <Icon className="size-4" aria-hidden />
                                  )}
                                </span>
                                <span className="min-w-0 leading-tight break-words">
                                  {promoTab.label}
                                </span>
                              </Link>
                            </li>
                          );
                        })}
                        <li>
                          <Link
                            href="/nalog"
                            onClick={close}
                            className="flex min-h-14 items-center gap-3 rounded-md border border-white/20 bg-white px-3 py-3 text-sm font-semibold text-brand-blue shadow-soft-1 transition hover:bg-brand-blue-50 focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none"
                          >
                            <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-brand-blue-50 text-brand-blue">
                              <User2 className="size-4" aria-hidden />
                            </span>
                            <span className="min-w-0 leading-tight break-words">Moj nalog</span>
                          </Link>
                        </li>
                      </ul>
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

                {stack.length !== 1 ? (
                  <ul className="divide-y divide-border">
                    {current.nodes.map((node) => {
                      const isActive = pathname === node.href;
                      const hasChildren = !!node.children?.length;
                      return (
                        <li key={node.href} className="min-h-14 transition hover:bg-muted-bg">
                          {hasChildren ? (
                            <button
                              type="button"
                              onClick={() => enter(node)}
                              className={cn(
                                "flex min-h-14 w-full min-w-0 items-center justify-between gap-3 px-4 py-3.5 text-left text-[15px] leading-snug font-medium text-ink-900 transition focus-visible:ring-2 focus-visible:ring-brand-blue/35 focus-visible:outline-none",
                                isActive && "font-semibold text-brand-blue",
                              )}
                            >
                              <span className="min-w-0 break-words">{node.label}</span>
                              <ChevronRight className="size-4 shrink-0 text-ink-500" aria-hidden />
                            </button>
                          ) : (
                            <Link
                              href={node.href}
                              onClick={close}
                              className={cn(
                                "flex min-h-14 w-full min-w-0 items-center justify-between gap-3 px-4 py-3.5 text-[15px] leading-snug font-medium break-words text-ink-900 transition focus-visible:ring-2 focus-visible:ring-brand-blue/35 focus-visible:outline-none",
                                isActive && "font-semibold text-brand-blue",
                              )}
                            >
                              <span className="min-w-0 break-words">{node.label}</span>
                              <ChevronRight className="size-4 shrink-0 text-ink-300" aria-hidden />
                            </Link>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                ) : null}

                {stack.length !== 1 ? (
                  <ul className="mt-3 border-t border-border">
                    {tabs.map((t) => {
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
