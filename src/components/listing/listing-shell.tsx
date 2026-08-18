"use client";

/**
 * Listing shell — orchestrates filter state, sort, view-toggle (3/4 col),
 * automatic scroll pagination, scroll-restore on back, and empty state.
 *
 * Visual chrome: page header, breadcrumbs,
 * sticky desktop sidebar, mobile sheet trigger, active filter chip strip.
 *
 * Filters are executed by the catalog API over the complete listing scope;
 * the client keeps the cursor, active query, and first-page fallback in sync.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { ArrowUp, LayoutGrid, ListFilter, RotateCcw, Rows3 } from "lucide-react";
import Image from "next/image";
import type { Banner, MediaAsset, Product } from "@/types";
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
import { formatDate as formatStorefrontDate } from "@/lib/format";
import {
  fetchListingFacets,
  fetchListingPage,
} from "@/lib/listing/fetch-products";
import {
  campaignStickers,
  type CampaignStickerKey,
} from "@/data/campaign-icons";
import {
  LISTING_PAGE_SIZE,
  type FilterState,
  type FacetExtents,
  type FacetValues,
  type ListingKind,
  type ListingSubTab,
  type SortKey,
  activeChips,
  appendFilterQueryParams,
  computeExtents,
  emptyFilterState,
  matchesListingSubTab,
  resolveListingProducts,
} from "@/lib/listing/filters";
import { OPEN_MOBILE_FILTERS_EVENT } from "@/lib/listing/mobile-filter-header";

export interface ListingPageQuery {
  categoryPath?: string;
  actionSlug?: string;
  permanentOnly?: boolean;
  onSaleOnly?: boolean;
  heroOnly?: boolean;
  newOnly?: boolean;
  limitedOnly?: boolean;
  outletOnly?: boolean;
  groupSlug?: string;
  collectionSlug?: string;
  maxPrice?: number;
}

interface ListingShellProps {
  kind: ListingKind;
  title: string;
  subtitle?: string;
  titleIcon?: MediaAsset;
  campaignSticker?: CampaignStickerKey;
  headerVariant?: "default" | "promo";
  /** Optional period banner (e.g. action validity). */
  period?: { startsAt?: string; endsAt: string; label?: string };
  periodPlacement?: "below-title" | "title-line";
  trail: Crumb[];
  source: Product[];
  initialNextCursor?: string | null;
  total?: number;
  pageQuery?: ListingPageQuery;
  /**
   * Optional sub-tabs row above the grid (used by /novo).
   * Tabs may match either a category label or a product name.
   * Kept serialisable so server components can configure the shell directly.
   */
  subTabs?: ListingSubTab[];
  initialSubTab?: string;
  /** Resolve interactions against `source` without another catalog request. */
  sourceIsComplete?: boolean;
  featureBanner?: Banner;
  featureBannerMobileOnly?: boolean;
  /** Hide page-level breadcrumbs/title when the listing is embedded below a landing hero. */
  displayMode?: "page" | "products-only";
  sectionId?: string;
}

const SCROLL_KEY = "spc:listing:scroll";

export function ListingShell({
  source,
  initialNextCursor = null,
  pageQuery,
  ...props
}: ListingShellProps) {
  const pageQueryString = useMemo(() => buildPageQueryString(pageQuery), [pageQuery]);
  const resetKey = `${props.kind}:${props.initialSubTab ?? ""}:${pageQueryString}:${
    source[0]?.sku ?? ""
  }:${source.at(-1)?.sku ?? ""}:${source.length}:${initialNextCursor ?? ""}`;

  return (
    <ListingShellInner
      key={resetKey}
      {...props}
      source={source}
      initialNextCursor={initialNextCursor}
      pageQuery={pageQuery}
      pageQueryString={pageQueryString}
    />
  );
}

interface ListingShellInnerProps extends ListingShellProps {
  pageQueryString: string;
}

function ListingShellInner({
  kind,
  title,
  subtitle,
  titleIcon,
  campaignSticker,
  period,
  periodPlacement = "below-title",
  trail,
  source,
  initialNextCursor = null,
  total,
  pageQueryString,
  subTabs,
  initialSubTab,
  sourceIsComplete = false,
  featureBanner,
  featureBannerMobileOnly = false,
  displayMode = "page",
  sectionId,
}: ListingShellInnerProps) {
  const [items, setItems] = useState(source);
  const [nextCursor, setNextCursor] = useState<string | null>(initialNextCursor);
  const [currentTotal, setCurrentTotal] = useState(total ?? source.length);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [facetData, setFacetData] = useState<{
    query: string;
    facets?: FacetValues;
    extents?: FacetExtents;
  }>();
  const [state, setState] = useState<FilterState>(() => emptyFilterState());
  const [sort, setSort] = useState<SortKey>("default");
  const [view, setView] = useState<3 | 5>(3);
  const [visibleWindow, setVisibleWindow] = useState({
    key: "",
    count: LISTING_PAGE_SIZE,
  });
  const [activeSub, setActiveSub] = useState<string | undefined>(initialSubTab);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

  useEffect(() => {
    const openMobileFilters = () => setMobileFiltersOpen(true);
    window.addEventListener(OPEN_MOBILE_FILTERS_EVENT, openMobileFilters);
    return () =>
      window.removeEventListener(OPEN_MOBILE_FILTERS_EVENT, openMobileFilters);
  }, []);
  const [showBackToTop, setShowBackToTop] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const listingQueryRef = useRef("");
  const displayTitleIcon =
    titleIcon ?? (campaignSticker ? campaignStickers[campaignSticker] : undefined);

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

  const activeSubTab = useMemo(() => {
    if (!subTabs?.length || !activeSub) return undefined;
    return subTabs.find((tab) => tab.id === activeSub);
  }, [activeSub, subTabs]);
  const facetQueryString = useMemo(() => {
    const params = new URLSearchParams(pageQueryString);
    appendSubTabQueryParam(params, activeSubTab);
    return params.toString();
  }, [activeSubTab, pageQueryString]);
  const serverFacets =
    facetData?.query === facetQueryString ? facetData.facets : undefined;
  const serverExtents =
    facetData?.query === facetQueryString ? facetData.extents : undefined;
  const listingQueryString = useMemo(() => {
    const params = new URLSearchParams(pageQueryString);
    appendFilterQueryParams(params, state, sort);
    appendSubTabQueryParam(params, activeSubTab);
    return params.toString();
  }, [activeSubTab, pageQueryString, sort, state]);
  const hasServerQuery =
    !sourceIsComplete &&
    (Boolean(activeSubTab) || sort !== "default" || !filterStateIsEmpty(state));

  useEffect(() => {
    listingQueryRef.current = listingQueryString;
  }, [listingQueryString]);

  useEffect(() => {
    const update = () => setShowBackToTop(window.scrollY > 600);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);

  useEffect(() => {
    if (sourceIsComplete) return;
    const controller = new AbortController();
    const params = new URLSearchParams(facetQueryString);
    void fetchListingFacets(params, controller.signal)
      .then((data) => {
        if (controller.signal.aborted) return;
        setFacetData({
          query: facetQueryString,
          facets: data.facets,
          extents: data.extents,
        });
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          console.error("[listing] Failed to load complete facets.", error);
        }
      });
    return () => controller.abort();
  }, [facetQueryString, sourceIsComplete]);

  useEffect(() => {
    const controller = new AbortController();
    if (!hasServerQuery) {
      void Promise.resolve().then(() => {
        if (controller.signal.aborted) return;
        setItems(source);
        setNextCursor(initialNextCursor);
        setCurrentTotal(total ?? source.length);
        setRefreshing(false);
        setLoadError(false);
      });
      return () => controller.abort();
    }

    const params = new URLSearchParams(listingQueryString);
    params.set("limit", String(LISTING_PAGE_SIZE));
    void Promise.resolve().then(() => {
      if (controller.signal.aborted) return;
      setRefreshing(true);
      setLoadingMore(false);
      setNextCursor(null);
      setLoadError(false);
    });
    void fetchListingPage(params, controller.signal)
      .then((data) => {
        if (controller.signal.aborted) return;
        setItems(data.items ?? []);
        setNextCursor(data.nextCursor ?? null);
        setCurrentTotal(data.total ?? 0);
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        console.error("[listing] Failed to refresh filtered products.", error);
        setLoadError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setRefreshing(false);
      });
    return () => controller.abort();
  }, [hasServerQuery, initialNextCursor, listingQueryString, source, total]);

  const subFiltered = useMemo(() => {
    if (!activeSubTab) return items;
    return items.filter((product) => matchesListingSubTab(product, activeSubTab));
  }, [activeSubTab, items]);

  const localExtents = useMemo(() => computeExtents(subFiltered), [subFiltered]);
  const extents = serverExtents ?? localExtents;

  const filtered = useMemo(
    () => resolveListingProducts(subFiltered, state, sort, kind, hasServerQuery),
    [hasServerQuery, subFiltered, state, sort, kind],
  );
  const displayedTotal = sourceIsComplete ? filtered.length : currentTotal;

  const visibleKey = useMemo(
    () => JSON.stringify({ state, sort, activeSub }),
    [state, sort, activeSub],
  );
  const visible =
    visibleWindow.key === visibleKey
      ? visibleWindow.count
      : LISTING_PAGE_SIZE;
  const chips = useMemo(
    () => activeChips(state, extents, subFiltered),
    [state, extents, subFiltered],
  );
  const shown = filtered.slice(0, visible);
  const hasLocalMore = filtered.length > shown.length;
  const hasServerMore = !refreshing && Boolean(nextCursor);
  const hasMore = !refreshing && (hasLocalMore || hasServerMore);

  const loadNextPage = useCallback(async () => {
    if (!nextCursor || loadingMore || refreshing) return;
    const requestQuery = listingQueryString;
    setLoadingMore(true);
    setLoadError(false);
    try {
      const params = new URLSearchParams(listingQueryString);
      params.set("cursor", nextCursor);
      params.set("limit", String(LISTING_PAGE_SIZE));
      const data = await fetchListingPage(params);
      if (listingQueryRef.current !== requestQuery) return;
      setItems((current) => {
        const seen = new Set(current.map((product) => product.sku));
        const incoming = (data.items ?? []).filter((product) => !seen.has(product.sku));
        return incoming.length ? [...current, ...incoming] : current;
      });
      setNextCursor(data.nextCursor ?? null);
      if (data.total != null) setCurrentTotal(data.total);
    } catch (error) {
      console.error("[listing] Failed to load more products.", error);
      setLoadError(true);
    } finally {
      setLoadingMore(false);
    }
  }, [listingQueryString, loadingMore, nextCursor, refreshing]);

  useEffect(() => {
    const target = loadMoreRef.current;
    if (!target || !hasMore) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        if (hasLocalMore) {
          setVisibleWindow((current) => ({
            key: visibleKey,
            count:
              current.key === visibleKey
                ? current.count + LISTING_PAGE_SIZE
                : LISTING_PAGE_SIZE * 2,
          }));
          return;
        }
        void loadNextPage();
      },
      { rootMargin: "900px 0px 900px" },
    );

    observer.observe(target);
    return () => observer.disconnect();
  }, [hasLocalMore, hasMore, loadNextPage, visibleKey]);

  const sidebar = (
    <FilterSidebar
      source={subFiltered}
      facetValues={serverFacets}
      extents={extents}
      state={state}
      onChange={setState}
    />
  );

  return (
    <div className="bg-canvas">
      <div
        id={sectionId}
        className={cn(
          "mx-auto w-full max-w-[var(--container-page)] pb-20",
          displayMode === "products-only"
            ? "scroll-mt-24 px-4 pt-8 md:px-6 md:pt-10"
            : "px-6 pt-6 md:pt-10",
        )}
      >
        {displayMode === "page" ? <Breadcrumbs trail={trail} className="mb-6" /> : null}

        {displayMode === "page" ? <header className="mb-4 md:mb-5">
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            className="max-w-4xl"
          >
            <div className="flex min-w-0 items-center gap-3 md:gap-5">
              {displayTitleIcon ? (
                <span className="flex size-14 shrink-0 items-center justify-center md:size-20">
                  <Image
                    src={displayTitleIcon.url}
                    alt={displayTitleIcon.alt ?? ""}
                    width={displayTitleIcon.width ?? 96}
                    height={displayTitleIcon.height ?? 96}
                    unoptimized={displayTitleIcon.url.endsWith(".svg")}
                    className="max-h-full max-w-full object-contain"
                    preload
                  />
                </span>
              ) : null}
              <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 md:gap-x-4">
                <h1 className="font-display min-w-0 text-2xl leading-tight text-ink-900 md:text-5xl">
                  {title}
                </h1>
                {period && periodPlacement === "title-line" ? (
                  <p className="inline-flex rounded-full bg-action/10 px-3 py-1 text-xs font-bold text-action ring-1 ring-action/20">
                    {period.label ?? "Akcija"} važi{period.startsAt ? ` od ${formatDate(period.startsAt)}` : ""} do {formatDate(period.endsAt)}
                  </p>
                ) : null}
              </div>
            </div>
            {period && periodPlacement === "below-title" ? (
              <p className="mt-2 inline-flex rounded-full bg-action/10 px-3 py-1 text-xs font-bold text-action ring-1 ring-action/20">
                {period.label ?? "Akcija"} važi{period.startsAt ? ` od ${formatDate(period.startsAt)}` : ""} do {formatDate(period.endsAt)}
              </p>
            ) : null}
            {!period && subtitle ? (
              <p className="mt-1 max-w-2xl text-sm leading-relaxed text-ink-700">
                {subtitle}
              </p>
            ) : null}
          </motion.div>
        </header> : null}

        {featureBanner ? (
          <div
            className={cn(
              "-mx-6 mb-6 md:mx-0 md:mb-8",
              featureBannerMobileOnly && "md:hidden",
            )}
          >
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
            <div className="sticky top-[calc(var(--storefront-sticky-header-height,9rem)+1rem)] max-h-[calc(100dvh-var(--storefront-sticky-header-height,9rem)-2rem)] overflow-y-auto overscroll-contain [scrollbar-gutter:stable]">
              {sidebar}
            </div>
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
                  {refreshing ? (
                    "Učitavam rezultate..."
                  ) : (
                    <>
                      {displayedTotal} {displayedTotal === 1 ? "rezultat" : "rezultata"}
                      {displayedTotal > items.length
                        ? ` (${items.length}/${displayedTotal} učitano)`
                        : ""}
                    </>
                  )}
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
                    onClick={() => setView(5)}
                    aria-pressed={view === 5}
                    aria-label="Pet kolona"
                    className={cn(
                      "inline-flex size-8 items-center justify-center rounded-full transition",
                      view === 5
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
                    <SelectValue>
                      {(value) =>
                        value ? SORT_LABELS[value as SortKey] : "Sortiraj"
                      }
                    </SelectValue>
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

            {refreshing ? (
              <div
                className={cn(
                  "grid grid-cols-2 gap-x-3 gap-y-4 sm:gap-x-4 sm:gap-y-6",
                  view === 5
                    ? "lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6"
                    : "lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4",
                )}
              >
                {Array.from({ length: 10 }, (_, index) => (
                  <ProductCardSkeleton key={index} />
                ))}
              </div>
            ) : shown.length ? (
              <div
                className={cn(
                  "grid grid-cols-2 gap-x-3 gap-y-4 sm:gap-x-4 sm:gap-y-6",
                  view === 5
                    ? "lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6"
                    : "lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4",
                )}
              >
                {shown.map((p) => (
                  <ProductCard
                    key={p.sku}
                    product={p}
                    campaignSticker={campaignSticker}
                  />
                ))}
              </div>
            ) : (
              <EmptyState onReset={() => setState(emptyFilterState())} />
            )}

            {hasMore ? (
              <div
                ref={loadMoreRef}
                className="flex h-16 items-center justify-center text-xs text-ink-500"
                role="status"
                aria-live="polite"
                aria-label={loadingMore ? "Učitavanje još proizvoda" : "Još proizvoda dostupno"}
              >
                {loadingMore
                  ? "Učitavam još proizvoda..."
                  : loadError
                    ? "Učitavanje nije uspelo. Skrolujte ili promenite filter za novi pokušaj."
                    : null}
              </div>
            ) : null}
          </div>
        </div>
      </div>
      {showBackToTop ? (
        <button
          type="button"
          aria-label="Povratak na vrh strane"
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          className="fixed right-4 bottom-4 z-40 inline-flex size-11 items-center justify-center rounded-full bg-ink-900 text-canvas shadow-soft-3 transition hover:bg-walnut focus-visible:ring-2 focus-visible:ring-walnut/40 focus-visible:outline-none md:right-6 md:bottom-6"
        >
          <ArrowUp className="size-5" aria-hidden />
        </button>
      ) : null}
    </div>
  );
}

function buildPageQueryString(query: ListingPageQuery | undefined) {
  const params = new URLSearchParams();
  if (!query) return "";
  for (const [key, value] of Object.entries(query)) {
    if (value == null || value === false) continue;
    params.set(key, String(value));
  }
  return params.toString();
}

const SORT_LABELS: Record<SortKey, string> = {
  default: "Podrazumevano",
  "price-asc": "Cena: rastuće",
  "price-desc": "Cena: opadajuće",
  "discount-desc": "% popusta",
};

function appendSubTabQueryParam(
  params: URLSearchParams,
  tab?: ListingSubTab,
) {
  if (!tab) return;
  params.set(
    tab.matchField === "name" ? "nameKeyword" : "categoryKeyword",
    tab.matchKeyword,
  );
}

function filterStateIsEmpty(state: FilterState) {
  return (
    !state.price &&
    !state.dimensions &&
    state.groups.length === 0 &&
    state.materials.length === 0 &&
    state.colors.length === 0 &&
    state.attributes.length === 0 &&
    state.availability.length === 0 &&
    Object.values(state.dynamic).every((values) => values.length === 0)
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

function formatDate(value: string) {
  return formatStorefrontDate(value);
}

/** Skeleton grid for suspense fallbacks. */
export function ListingSkeleton({ columns = 5 }: { columns?: 3 | 5 }) {
  return (
    <div
      className={cn(
        "mx-auto grid w-full max-w-[var(--container-page)] grid-cols-2 gap-x-3 gap-y-6 px-6 py-10 sm:gap-x-5 sm:gap-y-8",
        columns === 5
          ? "lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6"
          : "lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4",
      )}
    >
      {Array.from({ length: 8 }, (_, i) => (
        <ProductCardSkeleton key={i} />
      ))}
    </div>
  );
}
