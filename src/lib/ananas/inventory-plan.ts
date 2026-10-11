import { createHash } from "node:crypto";
import { z } from "zod";
import { isFiscalService } from "@/lib/admin/fiscal-merchandise";

export const ANANAS_INVENTORY_START = "2025-05-31T22:00:00.000Z"; // June 1, Belgrade
const item = z.object({ sku: z.string(), name: z.string(), quantity: z.number().int().positive().max(1000000) });
export function ananasInventoryPlan(kind: string, items: unknown) {
  if (kind !== "SALE" && kind !== "REFUND") throw new Error("Nepoznat tip Ananas dokumenta.");
  const rows = z.array(item).parse(items);
  const quantities = new Map<string, number>();
  for (const row of rows) {
    if (isFiscalService(row.sku, row.name)) continue;
    if (!row.sku.trim()) throw new Error("Ananas stavka nema šifru artikla.");
    quantities.set(row.sku, (quantities.get(row.sku) ?? 0) + row.quantity);
  }
  const lines = [...quantities].sort(([a], [b]) => a.localeCompare(b)).map(([sku, quantity]) => ({ sku, qtyDelta: quantity * (kind === "SALE" ? -1 : 1) }));
  return { lines, fingerprint: createHash("sha256").update(JSON.stringify([kind, lines])).digest("hex") };
}
