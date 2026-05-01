"use client";

/**
 * Tabs strip under hero — admin-controlled (max 4). Mobile: 2×2 grid; desktop: row.
 */
import Link from "next/link";
import { motion } from "framer-motion";
import {
  Tag,
  CalendarDays,
  Crown,
  Hourglass,
  ArrowUpRight,
  type LucideIcon,
} from "lucide-react";
import type { Tab } from "@/types";

const ICONS: Record<string, LucideIcon> = {
  Tag,
  CalendarDays,
  Crown,
  Hourglass,
};

interface TabsStripProps {
  tabs: Tab[];
}

export function TabsStrip({ tabs }: TabsStripProps) {
  return (
    <section
      aria-label="Aktuelne ponude"
      className="mx-auto w-full max-w-[var(--container-page)] px-6 py-10 md:py-14"
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
        {tabs.slice(0, 4).map((t, i) => {
          const Icon = (t.icon && ICONS[t.icon]) || Tag;
          return (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.4 }}
              transition={{
                duration: 0.45,
                ease: [0.22, 1, 0.36, 1],
                delay: i * 0.05,
              }}
            >
              <Link
                href={t.href}
                className="group bg-surface ring-border/60 hover:ring-walnut/40 focus-visible:ring-walnut/40 relative flex h-full items-center justify-between gap-4 rounded-2xl px-5 py-5 ring-1 shadow-soft-1 transition hover:shadow-soft-3 focus-visible:ring-2 focus-visible:outline-none md:px-6 md:py-6"
              >
                <span className="flex items-center gap-3">
                  <span className="bg-muted-bg text-walnut group-hover:bg-walnut grid size-10 place-items-center rounded-xl transition group-hover:text-canvas">
                    <Icon className="size-5" aria-hidden />
                  </span>
                  <span className="text-sm font-medium text-ink-900 md:text-base">
                    {t.label}
                  </span>
                </span>
                <ArrowUpRight
                  aria-hidden
                  className="size-4 text-ink-500 transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-walnut"
                />
              </Link>
            </motion.div>
          );
        })}
      </div>
    </section>
  );
}
