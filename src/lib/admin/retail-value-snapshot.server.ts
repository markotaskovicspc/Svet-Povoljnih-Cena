import "server-only";

import type { Prisma } from "@prisma/client";
import { buildRetailValueSnapshot } from "./retail-value-snapshot";

type RetailPriceDatabase = Pick<Prisma.TransactionClient, "priceListEntry">;

export async function createRetailValueSnapshot(
  tx: RetailPriceDatabase,
  input: {
    bookedAt: Date;
    items: Array<{ id: string; productId: string | null; sku: string; qty: number }>;
  },
) {
  const productIds = [...new Set(input.items.flatMap((item) => item.productId ? [item.productId] : []))];
  const entries = productIds.length
    ? await tx.priceListEntry.findMany({
        where: {
          productId: { in: productIds },
          price: { gt: 0 },
          validFrom: { lte: input.bookedAt },
          OR: [{ validTo: null }, { validTo: { gte: input.bookedAt } }],
          priceList: {
            is: {
              kind: "RETAIL",
              active: true,
              currency: "RSD",
              AND: [
                { OR: [{ validFrom: null }, { validFrom: { lte: input.bookedAt } }] },
                { OR: [{ validTo: null }, { validTo: { gte: input.bookedAt } }] },
              ],
            },
          },
        },
        orderBy: [{ validFrom: "desc" }, { priceList: { code: "asc" } }],
        select: { productId: true, price: true },
      })
    : [];
  const priceByProductId = new Map<string, number>();
  for (const entry of entries) {
    if (!priceByProductId.has(entry.productId)) {
      priceByProductId.set(entry.productId, Number(entry.price));
    }
  }
  return buildRetailValueSnapshot({ ...input, priceByProductId });
}
