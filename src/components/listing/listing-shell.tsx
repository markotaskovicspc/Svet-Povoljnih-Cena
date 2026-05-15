"use client";

/**
 * Listing shell — orchestrates filter state, sort, view-toggle (3/4 col),
 * "Učitaj još" cursor pagination, scroll-restore on back, and empty state.
 *
 * Visual chrome: page header (title/subtitle/period banner), breadcrumbs,
 * sticky desktop sidebar, mobile sheet trigger, active filter chip strip.
 *
 * Phase 1: pure client filtering over a pre-built product list. In Phase 4
 * `source` will be a server-paginated cursor — the same UI applies.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { LayoutGrid, ListFilter, RotateCcw, Rows3 } from "lucide-react";
import type { Product } from "@/types";
import type { Banner } from "@/types";
import { Breadcrumbs, type Crumb } from "@/components/layout/breadcrumbs";
import { ProtectedPricesBand } from "@/components/home/protected-prices-band";
import {
  ProductCard,
  ProductCardSkeleton,
} from "@/components/product/product-card";
import { FilterSidebar } from "@/components/listing/filter-sidebar";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/format";
import {
  LISTING_PAGE_SIZE,
  type FilterState,
  type ListingKind,
  type SortKey,
  activeChips,
  applyFilters,
  applySort,
  computeExtents,
  emptyFilterState,
} from "@/lib/listing/filters";

interface ListingShellProps {
  kind: ListingKind;
  title: string;
  subtitle?: string;
  /** Optional period banner (e.g. action validity). */
  period?: { startsAt?: string; endsAt: string; label?: string };
  trail: Crumb[];
  source: Product[];
  /**
   * Optional sub-tabs row above the grid (used by /novo).
   * `matchKeyword` is matched (case-insensitive) against the product's `categoryPath`.
   * Kept serialisable so server components can configure the shell directly.
   */
  subTabs?: { id: string; label: string; matchKeyword: string }[];
  initialSubTab?: string;
  featureBanner?: Banner;
}

const VIEW_KEY = "spc:listing:view";
const SCROLL_KEY = "spc:listing:scroll";

export function ListingShell({
  kind,
  title,
  subtitle,
  period,
  trail,
  source,
  subTabs,
  initialSubTab,
  featureBanner,
}: ListingShellProps) {
  const [state, setState] = useState<FilterState>(() => emptyFilterState());
  const [sort, setSort] = useState<SortKey>("default");
  const [view, setView] = useState<3 | 4>(() => {
    if (typeof window === "undefined") return 4;
    const v = window.localStorage.getItem(VIEW_KEY);
    return v === "3" || v === "4" ? (Number(v) as 3 | 4) : 4;
  });
  const [visibleWindow, setVisibleWindow] = useState({
    key: "",
    count: LISTING_PAGE_SIZE,
  });
  const [activeSub, setActiveSub] = useState<string | undefined>(initialSubTab);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(VIEW_KEY, String(view));
  }, [view]);

  // Scroll-restore on back navigation.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.sessionStorage.getItem(SCROLL_KEY);
    if (stored) {
      const y = Number(stored);
      if (Number.isFinite(y)) {
        requestAnimationFrame(() => window.scrollTo(0, y));
      }
      window.sessionStorage.removeItem(SCROLL_KEY);
    }
    const persist = () =>
      window.sessionStorage.setItem(SCROLL_KEY, String(window.scrollY));
    window.addEventListener("pagehide", persist);
    return () => window.removeEventListener("pagehide", persist);
  }, []);

  const subFiltered = useMemo(() => {
    if (!subTabs?.length || !activeSub) return source;
    const tab = subTabs.find((t) => t.id === activeSub);
    if (!tab) return source;
    const needle = tab.matchKeyword.toLowerCase();
    return source.filter((p) =>
      p.categoryPath.some((seg) => seg.toLowerCase().includes(needle)),
    );
  }, [source, subTabs, activeSub]);

  const extents = useMemo(() => computeExtents(subFiltered), [subFiltered]);

  const filtered = useMemo(
    () => applySort(applyFilters(subFiltered, state), sort, kind),
    [subFiltered, state, sort, kind],
  );

  const visibleKey = useMemo(
    () => JSON.stringify({ state, sort, activeSub }),
    [state, sort, activeSub],
  );
  const visible =
    visibleWindow.key === visibleKey
      ? visibleWindow.count
      : LISTING_PAGE_SIZE;
  const chips = useMemo(() => activeChips(state, extents), [state, extents]);
  const shown = filtered.slice(0, visible);
  const hasMore = filtered.length > shown.length;

  const sidebar = (
    <FilterSidebar
      source={subFiltered}
      extents={extents}
      state={state}
      onChange={setState}
    />
  );

  return (
    <div className="bg-canvas">
      <div className="mx-auto w-full max-w-[var(--container-page)] px-6 pt-6 pb-20 md:pt-10">
        <Breadcrumbs trail={trail} className="mb-6" />

        <header className="border-border/60 mb-6 flex flex-col gap-3 border-b pb-6 md:mb-8 md:pb-8">
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            className="max-w-3xl"
          >
            <p className="hidden font-mono text-[11px] tracking-[0.2em] text-walnut uppercase md:block md:text-xs">
              {kindEyebrow(kind)}
            </p>
            <h1 className="font-display mt-1.5 text-2xl text-ink-900 md:mt-2 md:text-5xl">
              {title}
            </h1>
            {subtitle ? (
              /* Hide marketing copy on mobile per spec — keep title + period only. */
              <p className="mt-3 hidden text-base text-ink-700 md:block">{subtitle}</p>
            ) : null}
          </motion.div>
          {period ? (
            <div className="bg-action/8 text-action ring-action/15 inline-flex w-fit items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium ring-1">
              <span aria-hidden className="size-1.5 rounded-full bg-action" />
              {period.label ?? "Akcija"} traje do {formatDate(period.endsAt)}
            </div>
          ) : null}
        </header>

        {featureBanner ? (
          <div className="-mx-6 mb-6 md:mx-0 md:mb-8">
            <ProtectedPricesBand banner={featureBanner} />
          </div>
        ) : null}

        {subTabs?.length ? (
          <div className="-mx-6 mb-6 flex gap-2 overflow-x-auto px-6 pb-1 [scrollbar-width:none] md:mx-0 md:px-0 [&::-webkit-scrollbar]:hidden">
            {subTabs.map((t) => {
              const active = t.id === activeSub;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setActiveSub(active ? undefined : t.id)}
                  className={cn(
                    "ring-border/60 hover:ring-walnut/40 inline-flex shrink-0 items-center rounded-full px-3.5 py-1.5 text-sm ring-1 transition",
                    active
                      ? "bg-ink-900 text-canvas ring-ink-900"
                      : "bg-surface text-ink-700",
                  )}
                  aria-pressed={active}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
        ) : null}

        <div className="grid gap-8 lg:grid-cols-[280px_1fr]">
          <div className="hidden lg:block">
            <div className="sticky top-28">{sidebar}</div>
          </div>

          <div className="min-w-0">
            <div
              className="border-border/60 mb-4 flex flex-wrap items-center justify-between gap-3 border-b pb-3"
              ref={gridRef}
            >
              <div className="flex items-center gap-3">
                <Sheet open={mobileFiltersOpen} onOpenChange={setMobileFiltersOpen}>
                  <SheetTrigger
                    aria-label="Otvori filtere"
                    className="ring-border/60 hover:bg-muted-bg/60 focus-visible:ring-walnut/40 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs ring-1 transition focus-visible:ring-2 focus-visible:outline-none lg:hidden"
                  >
                    <ListFilter className="size-3.5" aria-hidden /> Filteri
                    {chips.length ? (
                      <span className="bg-action ml-1 inline-flex size-4 items-center justify-center rounded-full text-[10px] text-white">
                        {chips.length}
                      </span>
                    ) : null}
                  </SheetTrigger>
                  <SheetContent
                    side="left"
                    className="w-[88vw] max-w-sm gap-0 overflow-y-auto p-4"
                  >
                    <SheetHeader className="px-0 pt-0">
                      <SheetTitle className="font-display">Filteri</SheetTitle>
                    </SheetHeader>
                    <div className="mt-3">{sidebar}</div>
                  </SheetContent>
                </Sheet>
                <p className="text-xs text-ink-500" aria-live="polite">
                  {filtered.length}{" "}
                  {filtered.length === 1 ? "rezultat" : "rezultata"}
                  {filtered.length !== subFiltered.length
                    ? ` od ${subFiltered.length}`
                    : ""}
                </p>
              </div>

              <div className="flex items-center gap-3">
                <div
                  role="group"
                  aria-label="Promeni gustinu prikaza"
                  className="ring-border/60 hidden rounded-full ring-1 md:inline-flex"
                >
                  <button
                    type="button"
                    onClick={() => setView(3)}
                    aria-pressed={view === 3}
                    aria-label="Tri kolone"
                    className={cn(
                      "inline-flex size-8 items-center justify-center rounded-full transition",
                      view === 3
                        ? "bg-ink-900 text-canvas"
                        : "text-ink-500 hover:text-ink-900",
                    )}
                  >
                    <LayoutGrid className="size-3.5" aria-hidden />
                  </button>
                  <button
                    type="button"
                    onClick={() => setView(4)}
                    aria-pressed={view === 4}
                    aria-label="Četiri kolone"
                    className={cn(
                      "inline-flex size-8 items-center justify-center rounded-full transition",
                      view === 4
                        ? "bg-ink-900 text-canvas"
                        : "text-ink-500 hover:text-ink-900",
                    )}
                  >
                    <Rows3 className="size-3.5" aria-hidden />
                  </button>
                </div>
                <Select
                  value={sort}
                  onValueChange={(v) => setSort(v as SortKey)}
                >
                  <SelectTrigger
                    aria-label="Sortiraj"
                    className="h-9 w-[200px] rounded-full text-xs"
                  >
                    <SelectValue placeholder="Sortiraj" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">Podrazumevano</SelectItem>
                    <SelectItem value="price-asc">Cena: rastuće</SelectItem>
                    <SelectItem value="price-desc">Cena: opadajuće</SelectItem>
                    <SelectItem value="discount-desc">% popusta</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {chips.length ? (
              <div className="mb-4 flex flex-wrap items-center gap-2">
                {chips.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setState(c.remove(state))}
                    className="ring-border/60 bg-surface text-ink-700 hover:text-action hover:ring-action/30 group inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs ring-1 transition"
                  >
                    {c.label}
                    <span aria-hidden className="text-ink-300 group-hover:text-action">
                      ×
                    </span>
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setState(emptyFilterState())}
                  className="hover:text-walnut inline-flex items-center gap-1 text-xs text-ink-500 transition"
                >
                  <RotateCcw className="size-3" aria-hidden /> Resetuj sve
                </button>
              </div>
            ) : null}

            {shown.length ? (
              <div
                className={cn(
                  "grid grid-cols-2 gap-x-3 gap-y-6 sm:gap-x-5 sm:gap-y-8",
                  view === 4
                    ? "lg:grid-cols-3 xl:grid-cols-4"
                    : "lg:grid-cols-2 xl:grid-cols-3",
                )}
              >
                {shown.map((p) => (
                  <ProductCard key={p.sku} product={p} />
                ))}
              </div>
            ) : (
              <EmptyState onReset={() => setState(emptyFilterState())} />
            )}

            {hasMore ? (
              <div className="mt-12 flex justify-center">
                <Button
                  type="button"
                  variant="outline"
                  size="lg"
                  className="rounded-full px-8"
                  onClick={() =>
                    setVisibleWindow({
                      key: visibleKey,
                      count: visible + LISTING_PAGE_SIZE,
                    })
                  }
                >
                  Učitaj još
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function EmptyState({ onReset }: { onReset: () => void }) {
  return (
    <div className="bg-surface ring-border/60 rounded-2xl px-6 py-16 text-center ring-1">
      <p className="font-display text-2xl text-ink-900">
        Nema rezultata za izabrane filtere
      </p>
      <p className="mt-2 text-sm text-ink-500">
        Probaj da proširiš opseg cene ili ukloniš neki filter.
      </p>
      <div className="mt-6 flex justify-center">
        <Button type="button" onClick={onReset}>
          Resetuj filtere
        </Button>
      </div>
    </div>
  );
}

/** Skeleton grid for suspense fallbacks. */
export function ListingSkeleton({ columns = 4 }: { columns?: 3 | 4 }) {
  return (
    <div
      className={cn(
        "mx-auto grid w-full max-w-[var(--container-page)] grid-cols-2 gap-x-3 gap-y-6 px-6 py-10 sm:gap-x-5 sm:gap-y-8",
        columns === 4 ? "lg:grid-cols-3 xl:grid-cols-4" : "lg:grid-cols-2 xl:grid-cols-3",
      )}
    >
      {Array.from({ length: 8 }, (_, i) => (
        <ProductCardSkeleton key={i} />
      ))}
    </div>
  );
}

function kindEyebrow(kind: ListingKind): string {
  switch (kind) {
    case "akcija":
      return "Akcija";
    case "nedeljna-akcija":
      return "Sedam dana";
    case "heroji-meseca":
      return "Selekcija meseca";
    case "niske-cene-pod-zastitom":
      return "Trajno zaštićene cene";
    case "outlet":
      return "Outlet";
    case "novo":
      return "Novo u ponudi";
    default:
      return "Kategorija";
  }
}
