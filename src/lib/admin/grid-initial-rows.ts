import type { AdminGridFilter, AdminGridSort, ErpModule } from "./erp";

/** Only reuse a complete, unfiltered first page from this server render. */
type InitialGridRequest = {
  page: number;
  query: string;
  filters: AdminGridFilter[];
  sorting: AdminGridSort[];
  context: Record<string, string>;
  reloadToken: number;
};

export function canReuseInitialGridRows(module: ErpModule, request: InitialGridRequest) {
  return module.initialRowsComplete === true && module.rows.length <= 100 &&
    request.page === 1 && !request.query.trim() && !request.filters.length &&
    !request.sorting.length && !Object.values(request.context).some(Boolean) &&
    request.reloadToken === 0;
}

export function createInitialGridRowsReuse(initialModule: ErpModule) {
  let reusable = true;
  return (module: ErpModule, request: InitialGridRequest) => {
    reusable = reusable && module === initialModule && canReuseInitialGridRows(module, request);
    return reusable;
  };
}

// Only builders that map each database record to exactly one row belong here.
// Merged stock lists and post-filtered product lists cannot prove completeness
// from their rendered row count and must always fetch their full result.
const oneRowPerRecordModules = new Set([
  "dobavljaci", "nabavne-cene", "porudzbenice", "porudzbenice-po-artiklima",
  "ulazne-fakture", "mp-cene", "sifarnici-artikala", "cenovnici",
  "akcijske-cene", "akcije", "loyalty", "linearne-promocije", "magacini",
  "popisi", "otpremnice", "preuzimanja", "kupci", "partner-klijenti",
  "partner-rezervacije", "racunovodstveni-registri", "landing-strane",
  "landing-sekcije", "pozicije-piktograma", "newsletter-kampanje",
  "posete-konverzije", "reklamacije-dnevnik", "admin-podesavanja",
]);

export function isInitialErpSnapshotComplete(
  slug: string,
  rowCount: number,
  take: number,
  options: {
    skip?: number;
    query?: string;
    warehouseId?: string | null;
    salesOrderFilters?: unknown;
    stocktakeArchived?: boolean;
  },
) {
  return oneRowPerRecordModules.has(slug) && rowCount < take &&
    !options.skip && !options.query?.trim() && !options.warehouseId &&
    !options.salesOrderFilters && !options.stocktakeArchived;
}
