import Link from "next/link";
import Image from "next/image";
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
import { getPromoTabPresentation } from "@/data/campaign-icons";
import { cn } from "@/lib/utils";

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
          const promoTab = getPromoTabPresentation(tab);
          const Icon =
            shortcutIconMap[tab.icon as keyof typeof shortcutIconMap] ?? Sparkles;
          const iconAsset = promoTab.iconAsset;
          const isLimitedPromo = promoTab.iconKey === "ogranicena-ponuda";
          return (
            <Link
              key={tab.id}
              href={promoTab.href}
              className="group flex min-h-20 items-center gap-3 rounded-md border border-brand-blue/10 bg-white px-3 py-3 text-brand-blue shadow-soft-1 transition hover:border-brand-blue/25 hover:bg-brand-blue-50 focus-visible:ring-2 focus-visible:ring-brand-blue/35 focus-visible:outline-none"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-brand-blue-50 text-brand-blue ring-1 ring-brand-blue/10">
                {iconAsset ? (
                  <Image
                    src={iconAsset.url}
                    alt=""
                    width={iconAsset.width ?? 80}
                    height={iconAsset.height ?? 80}
                    unoptimized={iconAsset.url.endsWith(".svg")}
                    className={cn(
                      "object-contain",
                      isLimitedPromo ? "h-10 w-10" : "h-7 w-7",
                    )}
                  />
                ) : (
                  <Icon className="size-4" aria-hidden />
                )}
              </span>
              <span className="min-w-0 text-sm font-semibold leading-tight break-words">
                {promoTab.label}
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
