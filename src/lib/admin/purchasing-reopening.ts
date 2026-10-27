import { z } from "zod";

const reopeningSchema = z.object({
  version: z.literal(1),
  token: z.uuid(),
  invoiceId: z.string().nullable(),
  warehouseId: z.string().min(1),
  supplierId: z.string().nullable(),
  products: z.array(z.object({
    productId: z.string().min(1),
    sku: z.string().min(1),
    qty: z.number().int().nonnegative(),
    costRsd: z.number().finite().nonnegative(),
  })),
});

export type PurchasingReopening = z.infer<typeof reopeningSchema>;

/** The original COGS booking snapshot stays intact alongside the correction baseline. */
export function readPurchasingReopening(value: unknown): PurchasingReopening | null {
  if (!value || typeof value !== "object" || Array.isArray(value) || !("reopening" in value)) return null;
  const parsed = reopeningSchema.safeParse(value.reopening);
  if (!parsed.success || new Set(parsed.data.products.map(p => p.productId)).size !== parsed.data.products.length) {
    throw new Error("Snimak ponovnog otvaranja nije ispravan. Knjiženje je zaustavljeno.");
  }
  return parsed.data;
}

export function withPurchasingReopening(value: unknown, reopening: PurchasingReopening | null) {
  const snapshot: Record<string, unknown> = value && typeof value === "object" && !Array.isArray(value) ? { ...value } : {};
  if (reopening) snapshot.reopening = reopeningSchema.parse(reopening);
  else delete snapshot.reopening;
  return Object.keys(snapshot).length ? snapshot : null;
}

/** Correct only the difference; sold units are never received a second time. */
export function purchasingCorrectionBalance(input: {
  sku: string; stock: number; cogs: number | null;
  previousQty: number; previousCostRsd: number; qty: number; costRsd: number;
}) {
  const qtyDelta = input.qty - input.previousQty;
  const stock = input.stock + qtyDelta;
  if (stock < 0) throw new Error(`Nema dovoljno raspoloživih zaliha za ispravku ${input.sku}.`);
  if (qtyDelta === 0 && input.costRsd === input.previousCostRsd) return { qtyDelta, stock, cogs: input.cogs };
  if (input.stock > 0 && input.cogs == null) throw new Error(`Nedostaje postojeći COGS za ${input.sku}.`);
  const costDelta = input.costRsd - input.previousCostRsd;
  const value = input.stock * (input.cogs ?? 0) + costDelta;
  if (stock > 0 && value < -0.005) throw new Error(`Ispravka bi dala negativan COGS za ${input.sku}. Proverite troškove i prethodne izlaze.`);
  return { qtyDelta, stock, cogs: stock > 0 ? Math.round((Math.max(0, value) / stock + Number.EPSILON) * 100) / 100 : input.cogs };
}
