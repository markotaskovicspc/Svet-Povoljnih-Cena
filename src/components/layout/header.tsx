"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { User2 } from "lucide-react";
import type { Tab } from "@/types";
import { cn } from "@/lib/utils";
import { InstantSearch } from "./instant-search";
import { CartButton, WishlistButton } from "./header-icons";
import { MobileNav } from "./mobile-nav";
import { DesktopMenu } from "./desktop-menu";

const SCROLL_THRESHOLD = 16;

export function Header({ tabs }: { tabs: Tab[] }) {
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
      className="bg-white text-brand-blue"
    >
      {/* Row 1 — desktop */}
      <div className="mx-auto hidden max-w-[var(--container-page)] items-center gap-4 px-6 py-3 md:flex md:py-4">
        <DesktopMenu tabs={tabs} />
        <Link href="/" aria-label="Svet Akcija — početna">
          <div className="shrink-0 rounded-lg px-2 py-1">
            <Image
              src="/logo.webp"
              alt="Svet Akcija"
              width={1600}
              height={382}
              priority
              className="h-auto w-[328px] max-w-[30vw] object-contain"
            />
          </div>
        </Link>
        <div className="mx-auto w-full max-w-[640px]">
          <InstantSearch />
        </div>
        <div className="flex items-center gap-1">
          <Link
            href="/nalog"
          className="inline-flex items-center gap-2 rounded-full px-3 py-2 text-[15px] font-semibold text-brand-blue/80 transition hover:bg-brand-blue/10 hover:text-brand-blue focus-visible:ring-2 focus-visible:ring-brand-blue/40 focus-visible:outline-none"
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
        className="mx-auto hidden max-w-[var(--container-page)] items-center gap-1 overflow-x-auto border-t border-brand-blue/10 px-6 py-2 md:flex [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {tabs.map((t) => {
          const active = pathname === t.href;
          return (
            <Link
              key={t.id}
              href={t.href}
              className={cn(
                "relative shrink-0 rounded-full px-3 py-1.5 text-[15px] font-semibold transition",
                active
                  ? "bg-brand-blue/10 text-brand-blue"
                  : "text-brand-blue/80 hover:bg-brand-blue/10",
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
      <div className="mx-auto flex max-w-[var(--container-page)] items-center justify-between gap-1 px-3 py-2.5 md:hidden">
        <MobileNav tabs={tabs} />
        <Link href="/" aria-label="Svet Akcija — početna" className="shrink-0">
          <div className="rounded-md px-1.5 py-0.5">
            <Image
              src="/logo.webp"
              alt="Svet Akcija"
              width={1600}
              height={382}
              priority
              className="h-auto w-[228px] object-contain min-[390px]:w-[258px]"
            />
          </div>
        </Link>
        <div className="flex items-center gap-0">
          <Link
            href="/nalog"
            aria-label="Moj nalog"
            className="inline-flex size-9 items-center justify-center rounded-full text-ink-700 transition hover:bg-muted-bg hover:text-ink-900 focus-visible:ring-2 focus-visible:ring-walnut/40 focus-visible:outline-none"
          >
            <User2 className="size-4" aria-hidden />
          </Link>
          <WishlistButton
            openDrawerOnClick={false}
            className="size-9 text-ink-700 hover:bg-muted-bg hover:text-ink-900 focus-visible:ring-walnut/40 [&_svg]:size-4"
          />
          <CartButton className="size-9 text-ink-700 hover:bg-muted-bg hover:text-ink-900 focus-visible:ring-walnut/40 [&_svg]:size-4" />
        </div>
      </div>
    </motion.header>
  );
}
