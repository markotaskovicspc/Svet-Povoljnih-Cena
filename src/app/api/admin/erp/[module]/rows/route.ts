import { selectArticleGridPage, supportsArticleGridSelection } from "@/lib/admin/article-grid-page";
import { NextResponse } from "next/server";
import { requireAdminAction } from "@/lib/admin";
import {
  countArticleRows,
  getErpModule,
  getErpModuleDefinition,
  type AdminGridFilter,
  type AdminGridSort,
} from "@/lib/admin/erp";
import { allowedRolesForErpModule } from "@/lib/admin/erp-access";
import {
  filterAndSortGridRows,
  parseGridArray,
} from "@/lib/admin/grid-query";
import { summarizeSalesOrderRows } from "@/lib/admin/sales-order-overview";
import { countErpDatabaseRows, supportsErpDatabasePagination } from "@/lib/admin/erp-pagination";

export async function GET(
  request: Request,
  context: { params: Promise<{ module: string }> },
) {
  const { module: slug } = await context.params;
  await requireAdminAction(allowedRolesForErpModule(slug));
  const search = new URL(request.url).searchParams;
  const page = Math.max(1, Number.parseInt(search.get("page") ?? "1", 10) || 1);
  const pageSize = Math.max(
    1,
    Math.min(100, Number.parseInt(search.get("pageSize") ?? "100", 10) || 100),
  );
  const start = (page - 1) * pageSize;
  const requestedSearchColumn = search.get("searchColumn") ?? "";
  const definition = getErpModuleDefinition(slug);
  if (!definition) {
    return NextResponse.json({ error: "Nepoznat admin modul." }, { status: 404 });
  }
  const knownColumns = new Set(definition.columns.map((column) => column.key));
  const requestedColumns = parseGridArray<string>(search.get("columns")).filter((key) =>
    knownColumns.has(key),
  );
  const columns = requestedColumns.length
    ? requestedColumns
    : definition.columns
        .filter((column) => column.defaultVisible)
        .map((column) => column.key);
  const searchColumns = knownColumns.has(requestedSearchColumn)
    ? [requestedSearchColumn]
    : columns;
  // Courier references also identify pickup batches, including in saved views
  // created before the courier-number column existed.
  if (
    slug === "preuzimanja" &&
    (!knownColumns.has(requestedSearchColumn) || requestedSearchColumn === "number") &&
    !searchColumns.includes("courierNumbers")
  ) {
    searchColumns.push("courierNumbers");
  }
  const filters = parseGridArray<AdminGridFilter>(search.get("filters")).filter(
    (filter) =>
      filter &&
      knownColumns.has(filter.columnKey) &&
      typeof filter.value === "string",
  );
  const sorting = parseGridArray<AdminGridSort>(search.get("sorting")).filter(
    (sort) =>
      sort &&
      knownColumns.has(sort.columnKey) &&
      (sort.direction === "asc" || sort.direction === "desc"),
  );
  const query = search.get("q") ?? "";
  const useDatabasePagination =
    (slug === "artikli" || supportsErpDatabasePagination(slug)) &&
    !search.get("warehouseId") && !search.get("archive") &&
    !query.trim() &&
    filters.length === 0 &&
    sorting.length === 0;
  const articleSelection = { query, searchColumn: requestedSearchColumn, searchColumns, filters, sorting };
  if (slug === "artikli" && !useDatabasePagination && supportsArticleGridSelection(articleSelection)) {
    const selected = await selectArticleGridPage(articleSelection, start, pageSize);
    const module = await getErpModule(slug, {
      take: pageSize, articleIds: selected.ids,
      warehouseId: search.get("warehouseId"), includeLookupOptions: false,
    });
    const byId = new Map(module?.rows.map((row) => [row.id, row]));
    return NextResponse.json({
      rows: selected.ids.flatMap((id) => { const row = byId.get(id); return row ? [row] : []; }),
      page, pageSize, total: selected.total,
      pageCount: Math.max(1, Math.ceil(selected.total / pageSize)),
    });
  }
  const [erpModule, databaseTotal] = await Promise.all([
    getErpModule(slug, {
      take: useDatabasePagination ? pageSize : 500_000,
      skip: useDatabasePagination ? start : 0,
      warehouseId: search.get("warehouseId"),
      includeLookupOptions: false,
      query: query || undefined,
      searchColumn: requestedSearchColumn || undefined,
      stocktakeArchived:
        slug === "popisi" && search.get("archive") === "1",
    }),
    useDatabasePagination
      ? slug === "artikli" ? countArticleRows() : countErpDatabaseRows(slug)
      : Promise.resolve(null),
  ]);
  if (!erpModule) {
    return NextResponse.json({ error: "Nepoznat admin modul." }, { status: 404 });
  }
  if (databaseTotal !== null) {
    return NextResponse.json({
      rows: erpModule.rows,
      page,
      pageSize,
      total: databaseTotal,
      pageCount: Math.max(1, Math.ceil(databaseTotal / pageSize)),
    });
  }
  const result = filterAndSortGridRows(
    erpModule.rows,
    searchColumns,
    query,
    filters,
    sorting,
  );
  return NextResponse.json({
    rows: result.slice(start, start + pageSize),
    page,
    pageSize,
    total: result.length,
    pageCount: Math.max(1, Math.ceil(result.length / pageSize)),
    summary:
      slug === "prodajni-nalozi"
        ? summarizeSalesOrderRows(result)
        : undefined,
  });
}
