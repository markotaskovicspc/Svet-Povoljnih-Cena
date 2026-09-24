import { z } from "zod";
const filter = z.object({ id: z.string(), columnKey: z.string(), operator: z.enum(["contains", "not_contains", "equals", "not_equals", "gt", "gte", "lt", "lte", "before", "after"]), value: z.string() });
const schema = z.object({
  version: z.literal(1), query: z.string(), searchColumn: z.string(),
  filters: z.array(filter), sorting: z.array(z.object({ columnKey: z.string(), direction: z.enum(["asc", "desc"]) })),
  visibleColumns: z.array(z.string()), columnOrder: z.array(z.string()),
  columnWidths: z.record(z.string(), z.number().finite().min(40).max(2000)),
  context: z.record(z.string(), z.string()), page: z.number().int().min(1),
});
/** Session-only list state, kept separately for each module and URL view. */
export function readGridNavigation(raw: string | null, columns: string[]) {
  if (!raw) return null;
  try {
    const parsed = schema.safeParse(JSON.parse(raw));
    if (!parsed.success) return null;
    const known = new Set(columns);
    const state = parsed.data;
    const visibleColumns = state.visibleColumns.filter(key => known.has(key));
    if (!visibleColumns.length) return null;
    const order = state.columnOrder.filter(key => known.has(key));
    return { ...state, visibleColumns,
      columnOrder: [...new Set([...order, ...columns])],
      searchColumn: known.has(state.searchColumn) ? state.searchColumn : "",
      filters: state.filters.filter(f => known.has(f.columnKey)),
      sorting: state.sorting.filter(s => known.has(s.columnKey)),
      columnWidths: Object.fromEntries(Object.entries(state.columnWidths).filter(([key]) => known.has(key))),
    };
  } catch { return null; }
}
