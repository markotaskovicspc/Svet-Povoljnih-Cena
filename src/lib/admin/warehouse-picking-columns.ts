/** Add the new column to views saved before it existed; preserve later choices to hide it. */
export function migrateWarehousePickingColumns(
  moduleSlug: string,
  visibleColumns: string[],
  columnOrder: string[],
) {
  if (moduleSlug !== "stanje-po-magacinima" || columnOrder.includes("pickingPosition")) {
    return { visibleColumns, columnOrder };
  }
  const insert = (columns: string[]) => {
    const result = columns.filter(key => key !== "pickingPosition");
    const skuIndex = result.indexOf("sku");
    result.splice(skuIndex >= 0 ? skuIndex + 1 : 0, 0, "pickingPosition");
    return result;
  };
  return { visibleColumns: insert(visibleColumns), columnOrder: insert(columnOrder) };
}
