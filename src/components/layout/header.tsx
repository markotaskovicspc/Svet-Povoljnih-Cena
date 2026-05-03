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
        boxShadow: scrolled
          ? "0 8px 20px rgba(4, 52, 120, 0.18), 0 2px 6px rgba(4, 52, 120, 0.10)"
          : "0 0 0 rgba(0,0,0,0)",
      }}
      transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
      className="sticky top-0 z-40 bg-brand-blue text-white"
    >
      {/* Row 1 — desktop */}
      <div className="mx-auto hidden max-w-[var(--container-page)] items-center gap-8 px-6 py-3 md:flex md:py-4">
        <Link
          href="/"
          aria-label="Svet povoljnih cena — početna"
          className="font-logo text-2xl leading-none tracking-wider text-white"
        >
          SVET <span className="text-sand">POVOLJNIH</span> CENA
        </Link>
        <div className="mx-auto w-full max-w-[640px]">
          <InstantSearch />
        </div>
        <div className="flex items-center gap-1">
          <Link
            href="/nalog"
            className="inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm text-white/90 transition hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:outline-none"
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
        className="mx-auto hidden max-w-[var(--container-page)] items-center gap-1 border-t border-white/10 px-6 py-2 md:flex"
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
                  ? "bg-white/10 text-white"
                  : "text-white/85 hover:bg-white/10 hover:text-white",
              )}
            >
              {t.label}
              {active ? (
                <motion.span
                  layoutId="header-tab-underline"
                  className="absolute right-3 -bottom-0.5 left-3 h-0.5 rounded-full bg-sand"
                  transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                />
              ) : null}
            </Link>
          );
        })}
      </nav>

      {/* Mobile bar */}
      <div className="mx-auto flex max-w-[var(--container-page)] items-center justify-between gap-2 px-3 py-2.5 md:hidden">
        <MobileNav />
        <Link
          href="/"
          aria-label="Svet povoljnih cena — početna"
          className="font-logo text-xl leading-none tracking-wider text-white"
        >
          SVET POVOLJNIH CENA
        </Link>
        <CartButton />
      </div>
    </motion.header>
  );
}
