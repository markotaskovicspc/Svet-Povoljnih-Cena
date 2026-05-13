"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronRight, Menu, Tag } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { headerTabs, primaryNav } from "@/data/site";
import { cn } from "@/lib/utils";

export function DesktopMenu() {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        aria-label="Otvori kategorije"
        className="hidden items-center gap-2 rounded-full px-3 py-2 text-sm font-medium text-brand-blue transition hover:bg-brand-blue/10 focus-visible:ring-2 focus-visible:ring-brand-blue/40 focus-visible:outline-none md:inline-flex"
      >
        <Menu className="size-4" aria-hidden />
        Meni
      </SheetTrigger>
      <SheetContent
        side="left"
        className="w-[min(94vw,960px)] max-w-none gap-0 overflow-y-auto bg-surface p-0"
      >
        <SheetHeader className="border-b border-white/10 bg-brand-blue px-6 py-5 text-white">
          <SheetTitle className="font-logo text-2xl tracking-wider text-white">
            KATEGORIJE
          </SheetTitle>
        </SheetHeader>

        <div className="grid gap-0 md:grid-cols-[260px_1fr]">
          <aside className="border-border/60 border-b bg-muted-bg/35 p-5 md:border-r md:border-b-0">
            <p className="font-mono text-[11px] tracking-[0.18em] text-ink-500 uppercase">
              Aktuelno
            </p>
            <nav aria-label="Aktuelne ponude" className="mt-3 space-y-1">
              {headerTabs.map((tab) => (
                <Link
                  key={tab.id}
                  href={tab.href}
                  onClick={close}
                  className="group flex items-center justify-between rounded-lg px-3 py-2.5 text-sm font-medium text-ink-700 transition hover:bg-surface hover:text-brand-blue"
                >
                  <span className="inline-flex items-center gap-2">
                    <Tag className="size-3.5 text-brand-blue/75" aria-hidden />
                    {tab.label}
                  </span>
                  <ChevronRight
                    className="size-3.5 text-ink-300 transition group-hover:translate-x-0.5 group-hover:text-brand-blue"
                    aria-hidden
                  />
                </Link>
              ))}
            </nav>
          </aside>

          <nav
            aria-label="Kategorije proizvoda"
            className="grid gap-x-8 gap-y-7 p-5 sm:grid-cols-2 lg:grid-cols-3"
          >
            {primaryNav.map((node) => (
              <section key={node.href} className="min-w-0">
                <Link
                  href={node.href}
                  onClick={close}
                  className="inline-flex items-center gap-1 text-base font-semibold text-ink-900 transition hover:text-brand-blue"
                >
                  {node.label}
                  <ChevronRight className="size-4" aria-hidden />
                </Link>
                {node.children?.length ? (
                  <ul className="mt-3 space-y-2">
                    {node.children.map((child) => (
                      <li key={child.href}>
                        <Link
                          href={child.href}
                          onClick={close}
                          className={cn(
                            "block truncate text-sm text-ink-700 transition hover:text-brand-blue",
                            child.children?.length && "font-medium text-ink-900",
                          )}
                        >
                          {child.label}
                        </Link>
                        {child.children?.length ? (
                          <ul className="mt-1.5 space-y-1.5 pl-3">
                            {child.children.map((grandchild) => (
                              <li key={grandchild.href}>
                                <Link
                                  href={grandchild.href}
                                  onClick={close}
                                  className="block truncate text-xs text-ink-500 transition hover:text-brand-blue"
                                >
                                  {grandchild.label}
                                </Link>
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </section>
            ))}
          </nav>
        </div>
      </SheetContent>
    </Sheet>
  );
}
