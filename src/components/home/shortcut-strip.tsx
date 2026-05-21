import Link from "next/link";
import {
  CalendarDays,
  Crown,
  Hourglass,
  Rows3,
  ShieldCheck,
  Sparkles,
  Tag,
} from "lucide-react";
import type { Tab } from "@/types";

const shortcutIconMap = {
  CalendarDays,
  Crown,
  Hourglass,
  Rows3,
  ShieldCheck,
  Sparkles,
  Tag,
};

export function ShortcutStrip({ tabs }: { tabs: Tab[] }) {
  const items = tabs.slice(0, 4);
  if (!items.length) return null;

  return (
    <section className="bg-white">
      <div className="mx-auto grid w-full max-w-[var(--container-page)] grid-cols-2 gap-3 px-4 py-4 md:grid-cols-4 md:px-6 md:py-6">
        {items.map((tab) => {
          const Icon =
            shortcutIconMap[tab.icon as keyof typeof shortcutIconMap] ?? Sparkles;
          return (
            <Link
              key={tab.id}
              href={tab.href}
              className="group flex min-h-20 items-center gap-3 rounded-md border border-brand-blue/10 bg-white px-3 py-3 text-brand-blue shadow-soft-1 transition hover:border-brand-blue/25 hover:bg-brand-blue-50 focus-visible:ring-2 focus-visible:ring-brand-blue/35 focus-visible:outline-none"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-brand-blue text-white">
                <Icon className="size-4" aria-hidden />
              </span>
              <span className="min-w-0 text-sm font-semibold leading-tight break-words">
                {tab.label}
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
