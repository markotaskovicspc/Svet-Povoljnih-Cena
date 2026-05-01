"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { User2 } from "lucide-react";
import { headerTabs } from "@/data/site";
import { cn } from "@/lib/utils";
import { InstantSearch } from "./instant-search";
import { CartButton, WishlistButton } from "./header-icons";
import { MobileNav } from "./mobile-nav";

const SCROLL_THRESHOLD = 16;

export function Header() {
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > SCROLL_THRESHOLD);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <motion.header
      initial={false}
      animate={{
        backgroundColor: scrolled ? "rgba(255,255,255,0.85)" : "rgba(250,247,242,1)",
        boxShadow: scrolled
          ? "0 8px 20px rgba(46, 35, 24, 0.08), 0 2px 6px rgba(46, 35, 24, 0.05)"
          : "0 0 0 rgba(0,0,0,0)",
      }}
      transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
      className="sticky top-0 z-40 border-b border-border backdrop-blur supports-[backdrop-filter]:bg-canvas/70"
    >
      {/* Row 1 — desktop */}
      <div className="mx-auto hidden max-w-[var(--container-page)] items-center gap-8 px-6 py-3 md:flex md:py-4">
        <Link
          href="/"
          aria-label="Svet povoljnih cena — početna"
          className="font-display text-xl leading-none tracking-tight text-ink-900"
        >
          Svet <span className="text-walnut">povoljnih</span> cena
        </Link>
        <div className="mx-auto w-full max-w-[640px]">
          <InstantSearch />
        </div>
        <div className="flex items-center gap-1">
          <Link
            href="/nalog"
            className="inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm text-ink-700 transition hover:bg-muted-bg hover:text-ink-900 focus-visible:ring-2 focus-visible:ring-walnut/40 focus-visible:outline-none"
          >
            <User2 className="size-4" aria-hidden /> Prijava
          </Link>
          <WishlistButton />
          <CartButton />
        </div>
      </div>

      {/* Row 2 — primary tabs (desktop) */}
      <nav
        aria-label="Glavna navigacija"
        className="mx-auto hidden max-w-[var(--container-page)] items-center gap-1 px-6 pb-3 md:flex"
      >
        {headerTabs.slice(0, 4).map((t) => {
          const active = pathname === t.href;
          return (
            <Link
              key={t.id}
              href={t.href}
              className={cn(
                "relative rounded-full px-3 py-1.5 text-sm transition",
                active
                  ? "text-walnut"
                  : "text-ink-700 hover:bg-muted-bg hover:text-ink-900",
              )}
            >
              {t.label}
              {active ? (
                <motion.span
                  layoutId="header-tab-underline"
                  className="absolute right-3 -bottom-0.5 left-3 h-0.5 rounded-full bg-walnut"
                  transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                />
              ) : null}
            </Link>
          );
        })}
      </nav>

      {/* Mobile bar */}
      <div className="mx-auto flex max-w-[var(--container-page)] items-center justify-between gap-2 px-3 py-2 md:hidden">
        <MobileNav />
        <Link
          href="/"
          aria-label="Svet povoljnih cena — početna"
          className="font-display text-base leading-none tracking-tight text-ink-900"
        >
          Svet <span className="text-walnut">povoljnih</span> cena
        </Link>
        <CartButton />
      </div>
    </motion.header>
  );
}
