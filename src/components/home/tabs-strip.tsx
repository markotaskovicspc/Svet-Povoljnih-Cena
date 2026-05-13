"use client";

/**
 * Tabs strip under hero — admin-controlled commercial shortcuts.
 */
import Link from "next/link";
import Image from "next/image";
import { motion } from "framer-motion";
import {
  Tag,
  CalendarDays,
  Crown,
  Hourglass,
  ShieldCheck,
  Sparkles,
  ArrowUpRight,
  type LucideIcon,
} from "lucide-react";
import type { Tab } from "@/types";

const ICONS: Record<string, LucideIcon> = {
  Tag,
  CalendarDays,
  Crown,
  Hourglass,
  ShieldCheck,
  Sparkles,
};

const HEROJI_MESECA_MARK_SRC = "/brand/heroji-meseca.png";

interface TabsStripProps {
  tabs: Tab[];
}

export function TabsStrip({ tabs }: TabsStripProps) {
  return (
    <section
      aria-label="Aktuelne ponude"
      className="mx-auto w-full max-w-[var(--container-page)] px-6 py-4 md:py-14"
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4 xl:grid-cols-6">
        {tabs.map((t, i) => {
          const Icon = (t.icon && ICONS[t.icon]) || Tag;
          const isHerojiMeseca = t.id === "heroji-meseca";
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
                className="group bg-surface ring-border/60 hover:ring-walnut/40 focus-visible:ring-walnut/40 relative flex h-full items-center justify-between gap-3 rounded-lg px-4 py-4 ring-1 shadow-soft-1 transition hover:shadow-soft-3 focus-visible:ring-2 focus-visible:outline-none md:px-5 md:py-5 xl:flex-col xl:items-start"
              >
                <span className="flex min-w-0 items-center gap-3 xl:flex-col xl:items-start">
                  <span className="bg-muted-bg text-walnut group-hover:bg-walnut grid size-10 shrink-0 place-items-center rounded-lg transition group-hover:text-canvas">
                    {isHerojiMeseca ? (
                      <Image
                        src={HEROJI_MESECA_MARK_SRC}
                        alt=""
                        width={36}
                        height={30}
                        className="h-7 w-8 object-contain transition group-hover:scale-105"
                      />
                    ) : (
                      <Icon className="size-5" aria-hidden />
                    )}
                  </span>
                  <span className="text-sm leading-tight font-medium text-ink-900">
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
