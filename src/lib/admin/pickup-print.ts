export type PickupPrintLine = {
  id: string;
  lineGroupKey: string;
  quantity: number | null;
  order: { number: string };
  reclamation: { number: string } | null;
  purpose: "ORDER_DELIVERY" | "RECLAMATION_RETURN" | "RECLAMATION_REPLACEMENT";
  orderItem: {
    id: string;
    sku: string;
    name: string;
    qty: number;
  } | null;
};

export type PickupPrintRow = {
  key: string;
  source: string;
  sku: string;
  name: string;
  quantity: number;
  packageCount: number;
};

/**
 * Keeps the printed picking list aligned with the detail screen: one row for
 * every visible order item inside every picking group, including legacy lines
 * whose OrderItem relation is no longer available.
 */
export function buildPickupPrintRows(
  lines: readonly PickupPrintLine[],
): PickupPrintRow[] {
  const rows = new Map<string, PickupPrintRow>();

  for (const line of lines) {
    const key = line.orderItem
      ? `${line.lineGroupKey}:${line.orderItem.id}`
      : `${line.lineGroupKey}:missing:${line.id}`;
    const current = rows.get(key);
    if (current) {
      current.packageCount += 1;
      continue;
    }

    rows.set(key, {
      key,
      source: pickupPrintSource(line),
      sku: line.orderItem?.sku ?? "—",
      name: line.orderItem?.name ?? "Artikal više nije povezan sa porudžbinom",
      quantity: line.quantity ?? line.orderItem?.qty ?? 0,
      packageCount: 1,
    });
  }

  return [...rows.values()].sort(
    (left, right) =>
      left.source.localeCompare(right.source, "sr-Latn", {
        numeric: true,
        sensitivity: "base",
      }) ||
      left.sku.localeCompare(right.sku, "sr-Latn", {
        numeric: true,
        sensitivity: "base",
      }),
  );
}

export function pickupPrintSource(
  line: Pick<PickupPrintLine, "order" | "reclamation" | "purpose">,
) {
  return line.purpose === "RECLAMATION_REPLACEMENT"
    ? `Zamena · ${line.reclamation?.number ?? line.order.number}`
    : line.order.number;
}
