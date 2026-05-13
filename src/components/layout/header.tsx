"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { User2 } from "lucide-react";
import { headerTabs } from "@/data/site";
import { cn } from "@/lib/utils";
import { BrandLogo } from "./brand-logo";
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
          ? "0 8px 20px rgba(26, 23, 20, 0.08), 0 2px 6px rgba(26, 23, 20, 0.06)"
          : "0 0 0 rgba(0,0,0,0)",
      }}
      transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
      className="border-border/70 sticky top-0 z-40 border-b bg-surface text-ink-900"
    >
      {/* Row 1 — desktop */}
      <div className="mx-auto hidden max-w-[var(--container-page)] items-center gap-8 px-6 py-3 md:flex md:py-4">
        <Link
          href="/"
          aria-label="Svet Akcija — početna"
          className="w-[178px] shrink-0"
        >
          <BrandLogo />
        </Link>
        <div className="mx-auto w-full max-w-[640px]">
          <InstantSearch />
        </div>
        <div className="flex items-center gap-1">
          <Link
            href="/nalog"
            className="hover:bg-muted-bg focus-visible:ring-walnut/40 inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm text-ink-700 transition hover:text-ink-900 focus-visible:ring-2 focus-visible:outline-none"
          >
            <User2 className="size-4" aria-hidden /> Prijava
          </Link>
          <WishlistButton className="text-ink-700 hover:bg-muted-bg hover:text-ink-900 focus-visible:ring-walnut/40" />
          <CartButton className="text-ink-700 hover:bg-muted-bg hover:text-ink-900 focus-visible:ring-walnut/40" />
        </div>
      </div>

      {/* Row 2 — primary tabs (desktop) */}
      <nav
        aria-label="Glavna navigacija"
        className="border-border/70 mx-auto hidden max-w-[var(--container-page)] items-center gap-1 border-t px-6 py-2 md:flex"
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
                  ? "bg-brand-blue-50 text-brand-blue"
                  : "text-ink-700 hover:bg-muted-bg hover:text-ink-900",
              )}
            >
              {t.label}
              {active ? (
                <motion.span
                  layoutId="header-tab-underline"
                  className="absolute right-3 -bottom-0.5 left-3 h-0.5 rounded-full bg-action"
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
          aria-label="Svet Akcija — početna"
          className="w-[136px] shrink-0"
        >
          <BrandLogo />
        </Link>
        <CartButton className="text-ink-700 hover:bg-muted-bg hover:text-ink-900 focus-visible:ring-walnut/40" />
      </div>
    </motion.header>
  );
}
