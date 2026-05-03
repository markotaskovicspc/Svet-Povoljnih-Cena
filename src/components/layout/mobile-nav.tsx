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
import { InstantSearch } from "./instant-search";

interface Crumb {
  label: string;
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
      setStack((s) => [...s, { label: node.label, nodes: node.children! }]);
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
          className="inline-flex size-10 items-center justify-center rounded-full text-white/90 hover:bg-white/10 hover:text-white"
        >
          <Menu className="size-5" aria-hidden />
        </SheetTrigger>
        <SheetContent side="left" className="w-[88vw] max-w-sm gap-0 bg-surface p-0">
          <SheetHeader className="border-b border-border bg-brand-blue px-4 py-3 text-white">
            <div className="flex items-center gap-2">
              {stack.length > 1 ? (
                <button
                  onClick={back}
                  aria-label="Nazad"
                  className="inline-flex size-8 items-center justify-center rounded-full text-white/90 hover:bg-white/10 hover:text-white"
                >
                  <ChevronLeft className="size-4" aria-hidden />
                </button>
              ) : null}
              <SheetTitle className="font-logo text-lg tracking-wider text-white">
                {stack.length === 1 ? "MENI" : current.label.toUpperCase()}
              </SheetTitle>
            </div>
          </SheetHeader>
          <div className="relative flex-1 overflow-hidden">
            <AnimatePresence mode="wait" initial={false}>
              <motion.ul
                key={stack.length + ":" + current.label}
                initial={{ x: 24, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: -24, opacity: 0 }}
                transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                className="divide-y divide-border"
              >
                {current.nodes.map((node) => {
                  const isActive = pathname === node.href;
                  const hasChildren = !!node.children?.length;
                  return (
                    <li key={node.href} className="flex items-stretch">
                      <Link
                        href={node.href}
                        onClick={close}
                        className={cn(
                          "flex-1 px-4 py-3 text-sm transition",
                          isActive
                            ? "bg-walnut/10 font-medium text-walnut"
                            : "text-ink-900 hover:bg-muted-bg",
                        )}
                      >
                        {node.label}
                      </Link>
                      {hasChildren ? (
                        <button
                          onClick={() => enter(node)}
                          aria-label={`Otvori ${node.label}`}
                          className="px-3 text-ink-500 hover:bg-muted-bg"
                        >
                          <ChevronRight className="size-4" aria-hidden />
                        </button>
                      ) : null}
                    </li>
                  );
                })}
              </motion.ul>
            </AnimatePresence>
          </div>
          <div className="border-t border-border bg-muted-bg/40 px-4 py-3">
            <ul className="space-y-1 text-sm">
              {headerTabs.map((t) => (
                <li key={t.id}>
                  <Link
                    href={t.href}
                    onClick={close}
                    className="block rounded-lg px-2 py-1.5 text-ink-700 hover:bg-surface hover:text-ink-900"
                  >
                    {t.label}
                  </Link>
                </li>
              ))}
              <li>
                <Link
                  href="/nalog"
                  onClick={close}
                  className="mt-2 inline-flex items-center gap-2 rounded-lg px-2 py-1.5 text-ink-700 hover:bg-surface hover:text-ink-900"
                >
                  <User2 className="size-4" aria-hidden /> Moj nalog
                </Link>
              </li>
            </ul>
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={searchOpen} onOpenChange={setSearchOpen}>
        <SheetTrigger
          aria-label="Pretraži"
          className="inline-flex size-10 items-center justify-center rounded-full text-white/90 hover:bg-white/10 hover:text-white"
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
          className="h-[100dvh] w-screen max-w-none gap-0 overflow-y-auto rounded-none border-0 p-0"
        >
          <SheetHeader className="border-b border-border bg-surface px-4 py-3">
            <SheetTitle className="font-display text-base text-ink-900">
              Pretraga
            </SheetTitle>
          </SheetHeader>
          <div className="bg-surface p-4">
            <InstantSearch />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
