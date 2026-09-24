export type PickupPrintLine = {
  id: string;
  lineGroupKey: string;
  quantity: number | null;
  purpose?: "ORDER_DELIVERY" | "RECLAMATION_RETURN" | "RECLAMATION_REPLACEMENT";
  reclamation?: {
    resolution: string | null;
    resolutionNote: string | null;
  } | null;
  orderItem: {
    id: string;
    sku: string;
    name: string;
    qty: number;
    product?: {
      barcode: string | null;
    } | null;
  } | null;
};

export type PickupPrintRow = {
  key: string;
  sku: string;
  name: string;
  barcode: string | null;
  quantity: number;
  packageCount: number;
  quantityDistribution: { quantity: number; orderCount: number }[];
};

/**
 * Produces one picking row per article across the entire batch. A logical order
 * item can have several physical package lines, so its quantity is added only
 * once while every physical package is still included in packageCount.
 * Distribution counts picking groups (customer orders), not physical packages;
 * separate item lines for the same SKU in one group are combined first.
 */
export function buildPickupPrintRows(
  lines: readonly PickupPrintLine[],
): PickupPrintRow[] {
  const rows = new Map<string, PickupPrintRow>();
  const countedItems = new Set<string>();
  const quantitiesByGroup = new Map<string, Map<string, number>>();

  for (const line of lines) {
    const isPartReplacement =
      line.purpose === "RECLAMATION_REPLACEMENT" &&
      line.reclamation?.resolution === "ZAMENA_DELA";
    const key = isPartReplacement
      ? `part:${line.lineGroupKey}`
      : line.orderItem
      ? `sku:${line.orderItem.sku}`
      : `missing:${line.id}`;
    const current = rows.get(key) ?? {
      key,
      sku: isPartReplacement
        ? `DEO ZA ${line.orderItem?.sku ?? "—"}`
        : line.orderItem?.sku ?? "—",
      name: isPartReplacement
        ? `${line.reclamation?.resolutionNote?.trim() || "Deo prema reklamaciji"} — NE SLATI CEO ARTIKAL (${line.orderItem?.name ?? "nepoznat artikal"})`
        : line.orderItem?.name ?? "Artikal više nije povezan sa porudžbinom",
      // A spare part must not carry the barcode of the complete article.
      barcode: isPartReplacement
        ? null
        : line.orderItem?.product?.barcode?.trim() || null,
      quantity: 0,
      packageCount: 0,
      quantityDistribution: [],
    };
    current.packageCount += 1;
    rows.set(key, current);

    const itemKey = line.orderItem
      ? `${line.lineGroupKey}:${line.orderItem.id}`
      : `missing:${line.id}`;
    if (countedItems.has(itemKey)) continue;

    const quantity = isPartReplacement
      ? 1
      : line.quantity ?? line.orderItem?.qty ?? 0;
    current.quantity += quantity;
    const groups = quantitiesByGroup.get(key) ?? new Map<string, number>();
    groups.set(line.lineGroupKey, (groups.get(line.lineGroupKey) ?? 0) + quantity);
    quantitiesByGroup.set(key, groups);
    countedItems.add(itemKey);
  }

  for (const [key, row] of rows) {
    const distribution = new Map<number, number>();
    for (const quantity of quantitiesByGroup.get(key)?.values() ?? []) {
      if (quantity <= 0) continue;
      distribution.set(quantity, (distribution.get(quantity) ?? 0) + 1);
    }
    row.quantityDistribution = [...distribution]
      .sort(([left], [right]) => right - left)
      .map(([quantity, orderCount]) => ({ quantity, orderCount }));
  }

  return [...rows.values()].sort(
    (left, right) =>
      left.sku.localeCompare(right.sku, "sr-Latn", {
        numeric: true,
        sensitivity: "base",
      }),
  );
}
