import "server-only";

import { db } from "@/lib/db";

// Archiving only changes visibility; document status and stock stay intact.
export async function setPurchaseOrdersArchived(ids: string[], archived: boolean) {
  if (!ids.length) throw new Error("Izaberite bar jednu porudžbenicu.");
  const result = await db.purchaseOrder.updateMany({
    where: {
      id: { in: [...new Set(ids)] },
      archivedAt: archived ? null : { not: null },
    },
    data: { archivedAt: archived ? new Date() : null },
  });
  return result.count;
}
