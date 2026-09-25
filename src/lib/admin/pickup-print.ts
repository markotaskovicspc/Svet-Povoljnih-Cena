import { readPackedItems } from "@/lib/courier/parcel-contents";
export type PickupPrintLine = {
  id: string;
  lineGroupKey: string;
  quantity: number | null;
  packedQuantity?: number;
  packedItems?: unknown;
  deferredAt?: Date | null;
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
    categoryName?: string | null;
    color1?: string | null;
    color2?: string | null;
    product?: {
      barcode: string | null;
      colorPrimary?: string | null;
      colorSecondary?: string | null;
      categories?: { category: { name: string; parent?: { name: string } | null } }[];
    } | null;
  } | null;
};

export type PickupPrintRow = {
  key: string;
  sku: string;
  name: string;
  barcode: string | null;
  category: string;
  color: string;
  quantity: number;
  packageCount: number;
  quantityDistribution: { quantity: number; orderCount: number }[];
};

/**
 * Produces one picking row per article across the entire batch. A logical order
 * item can have several physical package lines. Their snapshotted contents
 * are summed; legacy fixtures without a snapshot count the logical item once.
 * Distribution counts picking groups (customer orders), not physical packages;
 * separate item lines for the same SKU in one group are combined first.
 */
export function buildPickupPrintRows(
  lines: readonly PickupPrintLine[],
): PickupPrintRow[] {
  const rows = new Map<string, PickupPrintRow>();
  const countedItems = new Set<string>();
  const countedPackages = new Set<string>();
  const quantitiesByGroup = new Map<string, Map<string, number>>();

  const articleLines = lines.flatMap<PickupPrintLine>(line => {
    const contents = readPackedItems(line.packedItems);
    return contents.length ? contents.map(item => ({
      ...line, packedQuantity: item.quantity,
      orderItem: { id: item.orderItemId, sku: item.sku, name: item.name, qty: item.quantity,
        categoryName: item.categoryName, color1: item.color1, color2: item.color2,
        product: { barcode: item.barcode } },
    })) : [line];
  });
  for (const line of articleLines) {
    if (line.deferredAt) continue;
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
      category: line.orderItem?.product?.categories?.[0]?.category.parent?.name
        ?? line.orderItem?.product?.categories?.[0]?.category.name
        ?? line.orderItem?.categoryName ?? "Bez kategorije",
      color: [line.orderItem?.product?.colorPrimary ?? line.orderItem?.color1,
        line.orderItem?.product?.colorSecondary ?? line.orderItem?.color2].filter(Boolean).join(" / "),
      quantity: 0,
      packageCount: 0,
      quantityDistribution: [],
    };
    const packageKey = `${key}:${line.id}`;
    if (!countedPackages.has(packageKey)) current.packageCount += 1;
    countedPackages.add(packageKey);
    rows.set(key, current);

    const itemKey = line.orderItem
      ? `${line.lineGroupKey}:${line.orderItem.id}`
      : `missing:${line.id}`;
    if (line.packedQuantity == null && countedItems.has(itemKey)) continue;

    const quantity = isPartReplacement
      ? 1
      : line.packedQuantity ?? line.quantity ?? line.orderItem?.qty ?? 0;
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
      left.category.localeCompare(right.category, "sr-Latn", { sensitivity: "base" }) ||
      left.name.localeCompare(right.name, "sr-Latn", { numeric: true, sensitivity: "base" }) ||
      left.sku.localeCompare(right.sku, "sr-Latn", {
        numeric: true,
        sensitivity: "base",
      }),
  );
}
