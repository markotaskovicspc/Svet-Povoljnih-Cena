import "server-only";
import { db } from "@/lib/db";
import { articleSearchWhere } from "@/lib/admin/article-search";
import { filterAndSortGridRows } from "@/lib/admin/grid-query";
import type { AdminGridFilter, AdminGridSort, ErpRow } from "@/lib/admin/erp";

const columns = new Set([
  "status", "sku", "barcode", "supplierExternalId", "supplier",
  "supplierIntegrationKey", "shortName", "shortDescription",
  "attribute1", "attribute2", "attribute3", "attribute4", "color1", "color2",
]);

type Selection = {
  query: string;
  searchColumn: string;
  searchColumns: string[];
  filters: AdminGridFilter[];
  sorting: AdminGridSort[];
};

export function supportsArticleGridSelection(selection: Selection) {
  return (!selection.query.trim() || selection.searchColumns.every((key) => columns.has(key))) &&
    selection.filters.every((filter) => columns.has(filter.columnKey)) &&
    selection.sorting.every((sort) => columns.has(sort.columnKey));
}

/** Filter inexpensive scalar data with the existing JS rules, then hydrate just
 * the requested page. This preserves locale sorting, nulls and saved filters
 * without loading stock movements, reservations and media for the whole catalog.
 */
export async function selectArticleGridPage(selection: Selection, start: number, take: number) {
  const products = await db.product.findMany({
    where: articleSearchWhere(selection.query, selection.searchColumn),
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    take: 500_000,
    select: {
      id: true, articleStatus: true, sku: true, barcode: true,
      supplierExternalId: true, name: true, shortName: true, shortDescription: true,
      attribute1: true, attribute2: true, attribute3: true, attribute4: true,
      sizeLabel: true, colorPrimary: true, colorSecondary: true,
      supplier: { select: { name: true, integrationKey: true } },
    },
  });
  const rows: ErpRow[] = products.map((product) => ({
    id: product.id,
    values: {
      status: product.articleStatus,
      sku: product.sku,
      barcode: product.barcode ?? null,
      supplierExternalId: product.supplierExternalId,
      supplier: product.supplier?.name ?? null,
      supplierIntegrationKey: product.supplier?.integrationKey ?? null,
      shortName: product.shortName ?? product.name,
      shortDescription: product.shortDescription ?? null,
      attribute1: product.attribute1 ?? product.sizeLabel ?? null,
      attribute2: product.attribute2 ?? null,
      attribute3: product.attribute3 ?? null,
      attribute4: product.attribute4 ?? null,
      color1: product.colorPrimary ?? null,
      color2: product.colorSecondary ?? null,
    },
  }));
  const matches = filterAndSortGridRows(rows, selection.searchColumns, selection.query, selection.filters, selection.sorting);
  return { ids: matches.slice(start, start + take).map((row) => row.id), total: matches.length };
}
