"use client";

import Image from "next/image";
import { FolderTree, Layers3 } from "lucide-react";
import type { SearchHit, SearchSuggestion } from "@/types/search";
import { formatRsd } from "@/lib/format";
import { cn } from "@/lib/utils";

export function SearchSuggestionRow({
  hit,
  active = false,
  onActivate,
  onSelect,
  className,
  role = "option",
  id,
  wrapName = false,
}: {
  hit: SearchSuggestion;
  active?: boolean;
  onActivate?: () => void;
  onSelect: () => void;
  className?: string;
  role?: "option" | null;
  id?: string;
  wrapName?: boolean;
}) {
  return (
    <button
      id={id}
      type="button"
      onMouseEnter={onActivate}
      onFocus={onActivate}
      onClick={onSelect}
      role={role ?? undefined}
      aria-selected={role === "option" ? active : undefined}
      className={cn(
        "flex min-h-16 w-full items-center gap-3 px-3 py-2 text-left transition",
        active ? "bg-muted-bg" : "hover:bg-muted-bg/60",
        className,
      )}
    >
      <div className="relative grid size-12 shrink-0 place-items-center overflow-hidden rounded-lg bg-white text-walnut ring-1 ring-border/60">
        {hit.type === "product" && hit.thumbnailUrl ? (
          <Image src={hit.thumbnailUrl} alt="" fill sizes="48px" className="object-contain p-1" />
        ) : hit.type === "category" ? (
          <FolderTree className="size-5" aria-hidden />
        ) : hit.type === "group" ? (
          <Layers3 className="size-5" aria-hidden />
        ) : null}
      </div>
      <div className="min-w-0 flex-1">
        <div
          className={cn(
            "text-sm font-medium text-ink-900",
            wrapName ? "line-clamp-2" : "truncate",
          )}
        >
          {hit.name}
        </div>
        <div className="truncate font-mono text-[11px] text-ink-500">
          {hit.breadcrumb}
        </div>
      </div>
      {hit.type === "product" ? <SearchHitPrices hit={hit} /> : null}
    </button>
  );
}

export function SearchHitPrices({ hit }: { hit: SearchHit }) {
  const hasReducedPrice = Boolean(hit.actionPrice || hit.loyaltyPrice);
  return (
    <div className="shrink-0 text-right text-[11px] leading-tight">
      {hasReducedPrice ? (
        <div className="text-ink-400 line-through">{formatRsd(hit.fullPrice)}</div>
      ) : (
        <div className="text-sm font-semibold text-ink-900">{formatRsd(hit.fullPrice)}</div>
      )}
      {hit.actionPrice ? <div className="font-semibold text-action">Akcija {formatRsd(hit.actionPrice)}</div> : null}
      {hit.loyaltyPrice ? <div className="font-semibold text-walnut">Loyalty {formatRsd(hit.loyaltyPrice)}</div> : null}
    </div>
  );
}
