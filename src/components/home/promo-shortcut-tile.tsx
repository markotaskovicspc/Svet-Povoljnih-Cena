import Image from "next/image";
import Link from "next/link";
import {
  CalendarDays,
  Crown,
  Hourglass,
  Rows3,
  ShieldCheck,
  Sparkles,
  Tag,
  User2,
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
} as const;

const promoIconImageClassByKey = {
  "ogranicena-ponuda": "h-12 w-16",
  "niske-cene-pod-zastitom": "h-12 w-16",
} as const;

export function PromoShortcutTile({
  tab,
  active,
  className,
  onClick,
}: {
  tab: Tab;
  active?: boolean;
  className?: string;
  onClick?: () => void;
}) {
  const promoTab = getPromoTabPresentation(tab);
  const Icon = shortcutIconMap[tab.icon as keyof typeof shortcutIconMap] ?? Sparkles;
  const iconAsset = promoTab.iconAsset;
  const iconImageClass = promoTab.iconKey
    ? promoIconImageClassByKey[promoTab.iconKey as keyof typeof promoIconImageClassByKey]
    : undefined;

  return (
    <Link
      href={promoTab.href}
      onClick={onClick}
      className={cn(
        "group flex min-h-14 items-center gap-3 rounded-md border border-brand-blue/10 bg-white px-3 py-3 text-sm font-semibold text-brand-blue shadow-soft-1 transition hover:border-brand-blue/25 hover:bg-brand-blue-50 focus-visible:ring-2 focus-visible:ring-brand-blue/35 focus-visible:outline-none",
        active && "ring-2 ring-white/80",
        className,
      )}
    >
      <span className="flex h-12 w-16 shrink-0 items-center justify-center text-brand-blue">
        {iconAsset ? (
          <Image
            src={iconAsset.url}
            alt=""
            width={iconAsset.width ?? 96}
            height={iconAsset.height ?? 96}
            unoptimized={iconAsset.url.endsWith(".svg")}
            className={cn("h-9 w-9 object-contain", iconImageClass)}
          />
        ) : (
          <Icon className="size-5" aria-hidden />
        )}
      </span>
      <span className="min-w-0 leading-tight break-words">{promoTab.label}</span>
    </Link>
  );
}

export function AccountShortcutTile({
  active,
  className,
  onClick,
}: {
  active?: boolean;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <Link
      href="/nalog"
      onClick={onClick}
      className={cn(
        "flex min-h-14 items-center gap-3 rounded-md border border-brand-blue/10 bg-white px-3 py-3 text-sm font-semibold text-brand-blue shadow-soft-1 transition hover:border-brand-blue/25 hover:bg-brand-blue-50 focus-visible:ring-2 focus-visible:ring-brand-blue/35 focus-visible:outline-none",
        active && "text-action ring-2 ring-action/30",
        className,
      )}
    >
      <span
        className={cn(
          "flex size-9 shrink-0 items-center justify-center",
          active ? "text-action" : "text-brand-blue",
        )}
      >
        <User2 className="size-5" aria-hidden />
      </span>
      <span className="min-w-0 leading-tight break-words">Moj nalog</span>
    </Link>
  );
}
