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
  } | null;
};

export type PickupPrintRow = {
  key: string;
  sku: string;
  name: string;
  quantity: number;
  packageCount: number;
};

/**
 * Produces one picking row per article across the entire batch. A logical order
 * item can have several physical package lines, so its quantity is added only
 * once while every physical package is still included in packageCount.
 */
export function buildPickupPrintRows(
  lines: readonly PickupPrintLine[],
): PickupPrintRow[] {
  const rows = new Map<string, PickupPrintRow>();
  const countedItems = new Set<string>();

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
      quantity: 0,
      packageCount: 0,
    };
    current.packageCount += 1;
    rows.set(key, current);

    const itemKey = line.orderItem
      ? `${line.lineGroupKey}:${line.orderItem.id}`
      : `missing:${line.id}`;
    if (countedItems.has(itemKey)) continue;

    current.quantity += isPartReplacement
      ? 1
      : line.quantity ?? line.orderItem?.qty ?? 0;
    countedItems.add(itemKey);
  }

  return [...rows.values()].sort(
    (left, right) =>
      left.sku.localeCompare(right.sku, "sr-Latn", {
        numeric: true,
        sensitivity: "base",
      }),
  );
}
