import { z } from "zod";
import type { Product } from "@/types";

export const orderBumpSchema = z.object({
  offerId: z.string().trim().min(1).max(160),
  sourceSku: z.string().trim().min(1).max(64),
  quantity: z.int().min(1).max(99),
});

export type OrderBumpAttribution = z.infer<typeof orderBumpSchema>;
export const orderBumpViewMetadataSchema = orderBumpSchema.omit({ quantity: true }).extend({
  surface: z.literal("cart_order_bump"),
  event: z.literal("viewed"),
  eventId: z.string().uuid(),
});
export type CartOrderBumpOffer = {
  id: string;
  sourceSku: string;
  sourceName: string;
  product: Product;
};

/** Attribution is a line snapshot, never a price or discount instruction. */
export function normalizeOrderBump(value: unknown, qty: number): OrderBumpAttribution | undefined {
  const parsed = orderBumpSchema.safeParse(value);
  if (!parsed.success || qty <= 0) return undefined;
  return { ...parsed.data, quantity: Math.min(parsed.data.quantity, qty) };
}

export function checkoutOrderBump(
  line: { sku: string; qty: number; orderBump?: unknown },
) {
  const bump = normalizeOrderBump(line.orderBump, line.qty);
  // The source can be removed after adding the offer. The purchased addition
  // still came through the bump; only removing that addition clears its credit.
  if (!bump || bump.sourceSku === line.sku) return undefined;
  return bump;
}

export function defaultOrderBumpSku(name: string): string | undefined {
  return /\b(CITY LINE|ELEGANCE SEAT)\b/i.test(name) ? "210008" : undefined;
}
