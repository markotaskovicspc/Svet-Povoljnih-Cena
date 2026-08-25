"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import {
  Home,
  Menu,
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
import type { NavNode } from "@/data/site";
import { getPromoTabPresentation } from "@/data/campaign-icons";
import {
  AccountShortcutTile,
  PromoShortcutTile,
} from "@/components/home/promo-shortcut-tile";
import { cn } from "@/lib/utils";
import { BRAND } from "@/lib/brand";
import type { Tab } from "@/types";
import { InstantSearch } from "./instant-search";
import { useLoyaltyEligibility } from "@/components/pricing/pricing-eligibility";
import { customerLoginHref } from "@/lib/auth/customer-callback";
import { CategoryMenuGrid } from "./category-menu-grid";
import { MobileCategoryLevel } from "./mobile-category-level";

interface Crumb {
  label: string;
  href?: string;
  nodes: NavNode[];
}

const mobileMenuShortcutTabs = [
  {
    id: "ogranicena-ponuda",
    label: "Dok traju zalihe",
    href: "/ogranicena-ponuda",
    order: 1,
    icon: "Hourglass",
  },
  {
    id: "heroji-meseca",
    label: "Heroji meseca",
    href: "/heroji-meseca",
    order: 2,
    icon: "Crown",
  },
  {
    id: "mesecna-akcija",
    label: "Mesečna akcija",
    href: "/akcija",
    order: 3,
    icon: "Tag",
  },
  {
    id: "niske-cene-pod-zastitom",
    label: "Trajno niske cene",
    href: "/niske-cene-pod-zastitom",
    order: 4,
    icon: "ShieldCheck",
  },
] satisfies Tab[];

export function MobileNav({
  tabs,
  categories,
}: {
  tabs: Tab[];
  categories: NavNode[];
}) {
  const pathname = usePathname();
  const isCustomerLoggedIn = useLoyaltyEligibility();
  const accountHref = isCustomerLoggedIn
    ? "/nalog"
    : customerLoginHref(pathname);
  const [open, setOpen] = useState(false);
  const [stack, setStack] = useState<Crumb[]>([
    { label: "Sve kategorije", nodes: categories },
  ]);
  const shortcutTabs = tabs.length ? tabs : mobileMenuShortcutTabs;

  const current = stack[stack.length - 1];

  const enter = (node: NavNode) => {
    if (node.children?.length) {
      setStack((s) => [
        ...s,
        { label: node.label, href: node.href, nodes: node.children! },
      ]);
    }
  };
  const back = () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));

  const close = () => {
    setOpen(false);
    setTimeout(
      () => setStack([{ label: "Sve kategorije", nodes: categories }]),
      250,
    );
  };

  return (
    <div className="flex items-center gap-1 md:hidden">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger
          aria-label="Otvori navigaciju"
          className="hover:bg-muted-bg inline-flex size-10 -translate-x-1 items-center justify-center rounded-full text-ink-700 hover:text-ink-900"
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
                aria-label={`${BRAND.name} - početna`}
                onClick={close}
                className="min-w-0 justify-self-center"
              >
                <Image
                  src="/logo-mobile.svg"
                  alt={BRAND.name}
                  width={995}
                  height={124}
                  preload
                  className="h-auto w-[min(61vw,257px)] max-w-full scale-110 object-contain"
                />
              </Link>
              <div className="flex shrink-0 items-center justify-end gap-1">
                <Link
                  href="/"
                  onClick={close}
                  aria-label="Početna"
                  className="inline-flex size-10 items-center justify-center rounded-full text-ink-700 transition hover:bg-muted-bg hover:text-ink-900 focus-visible:ring-2 focus-visible:ring-brand-blue/35 focus-visible:outline-none"
                >
                  <Home className="size-5" aria-hidden />
                </Link>
                <Link
                  href={accountHref}
                  onClick={close}
                  aria-label="Moj nalog"
                  className={cn(
                    "inline-flex size-10 items-center justify-center rounded-full transition hover:bg-muted-bg focus-visible:ring-2 focus-visible:ring-brand-blue/35 focus-visible:outline-none",
                    isCustomerLoggedIn
                      ? "bg-action text-white hover:bg-action/90 hover:text-white"
                      : "bg-muted-bg text-ink-700 ring-1 ring-border/60 hover:text-ink-900",
                  )}
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

          <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-white">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={stack.length + ":" + current.label}
                initial={{ x: 24, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: -24, opacity: 0 }}
                transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                className={cn(
                  "min-h-0 flex-1",
                  stack.length === 1
                    ? "flex flex-col overflow-y-auto overscroll-contain"
                    : "flex flex-col overflow-hidden",
                )}
              >
                {stack.length === 1 ? (
                  <>
                    <CategoryMenuGrid
                      categories={current.nodes}
                      onEnter={enter}
                      onNavigate={close}
                    />

                    <div className="min-h-fit flex-1 border-y border-brand-blue/10 bg-brand-blue px-[clamp(10px,3.2vw,14px)] pt-3 pb-[max(env(safe-area-inset-bottom),0.75rem)]">
                      <ul className="grid grid-cols-2 gap-[clamp(10px,3vw,13px)]">
                        {shortcutTabs.map((t) => {
                          const promoTab = getPromoTabPresentation(t);
                          const isActive = pathname === promoTab.href;
                          return (
                            <li key={t.id}>
                              <PromoShortcutTile
                                tab={t}
                                active={isActive}
                                compact
                                onClick={close}
                                className="h-[clamp(42px,13vw,60px)] border-white/20 text-[clamp(11px,3.15vw,13px)] focus-visible:ring-white/70"
                              />
                            </li>
                          );
                        })}
                        <li>
                          <AccountShortcutTile
                            active={isCustomerLoggedIn}
                            href={accountHref}
                            compact
                            onClick={close}
                            className="h-[clamp(42px,13vw,60px)] border-white/20 text-[clamp(11px,3.15vw,13px)] focus-visible:ring-white/70"
                          />
                        </li>
                      </ul>
                    </div>
                  </>
                ) : null}

                {stack.length !== 1 ? (
                  <MobileCategoryLevel
                    category={{
                      label: current.label,
                      href: current.href!,
                      children: current.nodes,
                    }}
                    pathname={pathname}
                    onBack={back}
                    onEnter={enter}
                    onNavigate={close}
                  />
                ) : null}
              </motion.div>
            </AnimatePresence>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
