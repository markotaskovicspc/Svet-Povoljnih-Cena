import "server-only";
import { db } from "@/lib/db";
import {
  isReclamationMoneyReturn,
  reclamationWarehouseStatus,
  type ReclamationWarehouseClaim,
} from "./reclamation-warehouse-status";

/** One receipt query per page/export batch, with exact claim attribution. */
export async function reclamationWarehouseStatuses(claims: ReclamationWarehouseClaim[]) {
  const returns = claims.filter(isReclamationMoneyReturn);
  const receiptQuantities = new Map<string, { aggregate: number | null; parcels: number }>();
  if (returns.length) {
    const returnIds = new Set(returns.map((claim) => claim.id));
    const receipts = await db.stockMovement.findMany({
      where: {
        orderId: { in: [...new Set(returns.map((claim) => claim.orderId))] },
        kind: "REFUND_RETURN",
        idempotencyKey: { startsWith: "reclamation-return:" },
      },
      select: { idempotencyKey: true, qty: true },
    });
    for (const receipt of receipts) {
      const key = receipt.idempotencyKey;
      const id = key?.split(":")[1];
      if (!key || !id || !returnIds.has(id)) continue;
      const base = `reclamation-return:${id}`;
      const quantities = receiptQuantities.get(id) ?? { aggregate: null, parcels: 0 };
      if (key === base) quantities.aggregate = receipt.qty;
      else if (key.startsWith(`${base}:parcel:`)) quantities.parcels += receipt.qty;
      receiptQuantities.set(id, quantities);
    }
  }
  return new Map(claims.map((claim) => {
    const receipts = receiptQuantities.get(claim.id);
    // A legacy whole-claim receipt supersedes parcel receipts; never count both.
    return [claim.id, reclamationWarehouseStatus(claim, receipts?.aggregate ?? receipts?.parcels ?? 0)];
  }));
}
