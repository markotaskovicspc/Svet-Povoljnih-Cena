/** Immutable contents of a parcel containing several sellable order lines. */
export type PackedItem = {
  orderItemId: string;
  quantity: number;
  sku: string;
  name: string;
  barcode: string | null;
  categoryName: string | null;
  color1: string | null;
  color2: string | null;
  unitValue: number | null;
};

export function readPackedItems(value: unknown): PackedItem[] {
  if (value == null) return [];
  if (!Array.isArray(value) || !value.length) throw new Error("Nedostaje sadržaj zajedničkog paketa.");
  const ids = new Set<string>();
  return value.map((entry) => {
    if (!entry || typeof entry !== "object" ||
        typeof entry.orderItemId !== "string" || !entry.orderItemId || ids.has(entry.orderItemId) ||
        !Number.isSafeInteger(entry.quantity) || entry.quantity < 1 ||
        typeof entry.sku !== "string" || typeof entry.name !== "string" ||
        ![entry.barcode, entry.categoryName, entry.color1, entry.color2].every(v => v === null || typeof v === "string") ||
        !(entry.unitValue === null || (typeof entry.unitValue === "number" && Number.isFinite(entry.unitValue) && entry.unitValue >= 0))) {
      throw new Error("Neispravan sadržaj zajedničkog paketa. Proverite picking nalog.");
    }
    ids.add(entry.orderItemId);
    return entry as PackedItem;
  });
}

export function parcelOrderItemIds(line: { orderItemId?: string | null; packedItems?: unknown }): string[] {
  const items = readPackedItems(line.packedItems);
  return items.length ? items.map(item => item.orderItemId) : line.orderItemId ? [line.orderItemId] : [];
}

export function packedItemsValue(value: unknown): number | null {
  const items = readPackedItems(value);
  if (!items.length) return null;
  if (items.some(item => item.unitValue == null)) throw new Error("Zajednički paket nema sačuvanu vrednost svih artikala.");
  return Math.round(items.reduce((sum, item) => sum + item.quantity * item.unitValue!, 0) * 100) / 100;
}

export function packedItemsContent(value: unknown): string | undefined {
  const items = readPackedItems(value);
  return items.length ? items.map(item => `${item.quantity} × ${item.sku ? `${item.sku} · ` : ""}${item.name}`).join("; ") : undefined;
}

/** Short enough for the fixed courier label; picking keeps the full article list. */
export function packedItemsLabel(value: unknown): string | undefined {
  const items = readPackedItems(value);
  return items.length ? `POMPEA · ${items.length} stavki · ${items.reduce((sum, item) => sum + item.quantity, 0)} kom` : undefined;
}
