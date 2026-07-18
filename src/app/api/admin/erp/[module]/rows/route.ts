import { NextResponse } from "next/server";
import { requireAdminAction } from "@/lib/admin";
import {
  getErpModule,
  type AdminGridFilter,
  type AdminGridSort,
} from "@/lib/admin/erp";
import { allowedRolesForErpModule } from "@/lib/admin/erp-access";
import {
  filterAndSortGridRows,
  parseGridArray,
} from "@/lib/admin/grid-query";

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
  const module = await getErpModule(slug, { take: 10_000 });
  if (!module) {
    return NextResponse.json({ error: "Nepoznat admin modul." }, { status: 404 });
  }
  const knownColumns = new Set(module.columns.map((column) => column.key));
  const requestedColumns = parseGridArray<string>(search.get("columns")).filter((key) =>
    knownColumns.has(key),
  );
  const columns = requestedColumns.length
    ? requestedColumns
    : module.columns.filter((column) => column.defaultVisible).map((column) => column.key);
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
  const result = filterAndSortGridRows(
    module.rows,
    columns,
    search.get("q") ?? "",
    filters,
    sorting,
  );
  const start = (page - 1) * pageSize;
  return NextResponse.json({
    rows: result.slice(start, start + pageSize),
    page,
    pageSize,
    total: result.length,
    pageCount: Math.max(1, Math.ceil(result.length / pageSize)),
  });
}
