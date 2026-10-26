/** Add new columns to legacy DC views; preserve later choices to hide or move them. */
export function migrateWarehouseGridColumns(
  moduleSlug: string,
  visibleColumns: string[],
  columnOrder: string[],
) {
  if (moduleSlug !== "stanje-po-magacinima") {
    return { visibleColumns, columnOrder };
  }
  let migrated = { visibleColumns, columnOrder };
  for (const [key, after] of [
    ["barcode", "sku"], ["pickingPosition", "barcode"],
    ["firstIncomingDate", "incoming"], ["firstIncomingQty", "firstIncomingDate"],
  ]) {
    if (migrated.columnOrder.includes(key)) continue;
    const incomingColumn = key === "firstIncomingDate" || key === "firstIncomingQty";
    const insert = (columns: string[]) => {
      const result = columns.filter(column => column !== key);
      const anchorIndex = result.indexOf(after);
      const skuIndex = result.indexOf("sku");
      result.splice(anchorIndex >= 0 ? anchorIndex + 1 : incomingColumn ? result.length : skuIndex >= 0 ? skuIndex + 1 : 0, 0, key);
      return result;
    };
    migrated = {
      visibleColumns: insert(migrated.visibleColumns),
      columnOrder: insert(migrated.columnOrder),
    };
  }
  return migrated;
}
