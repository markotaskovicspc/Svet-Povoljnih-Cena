import "server-only";
import { db } from "@/lib/db";
import {
  isReclamationMoneyReturn,
  reclamationReplacementRestoreKey,
  reclamationReplacementReturnStatus,
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
  // Only a handed-over replacement can come back from the courier.
  const sentReplacements = claims.filter((claim) => !isReclamationMoneyReturn(claim) && claim.warehouseStatus === "HANDED_OVER");
  const returnedReplacements = new Set<string>();
  const receivedReplacements = new Set<string>();
  if (sentReplacements.length) {
    const ids = sentReplacements.map((claim) => claim.id);
    const [shipments, restores] = await Promise.all([
      db.shipment.findMany({
        where: { reclamationId: { in: ids }, purpose: "RECLAMATION_REPLACEMENT", status: "RETURNED" },
        select: { reclamationId: true },
      }),
      db.stockMovement.findMany({
        where: { idempotencyKey: { in: ids.map(reclamationReplacementRestoreKey) } },
        select: { idempotencyKey: true },
      }),
    ]);
    for (const shipment of shipments) if (shipment.reclamationId) returnedReplacements.add(shipment.reclamationId);
    const restoreKeys = new Set(restores.map((row) => row.idempotencyKey));
    for (const id of ids) if (restoreKeys.has(reclamationReplacementRestoreKey(id))) receivedReplacements.add(id);
  }
  return new Map(claims.map((claim): [string, string] => {
    const replacementStatus = reclamationReplacementReturnStatus(returnedReplacements.has(claim.id), receivedReplacements.has(claim.id));
    if (replacementStatus) return [claim.id, replacementStatus];
    const receipts = receiptQuantities.get(claim.id);
    // A legacy whole-claim receipt supersedes parcel receipts; never count both.
    return [claim.id, reclamationWarehouseStatus(claim, receipts?.aggregate ?? receipts?.parcels ?? 0)];
  }));
}

/**
 * „Neobrađene“ (Marko, 14.11.2026): otvorene reklamacije kojima nije dat nalog za rešavanje, tj. stvarni status
 * pripreme je „Nije zatraženo“. Umanjenje cene se ne broji jer ne traži magacinski nalog.
 */
export async function countUntaskedReclamations() {
  const claims = await db.reclamation.findMany({
    where: { status: { in: ["PRIMLJENO", "U_OBRADI"] }, OR: [{ resolution: null }, { resolution: { not: "POPUST" } }] },
    select: { id: true, orderId: true, quantity: true, request: true, resolution: true, warehouseStatus: true },
  });
  const statuses = await reclamationWarehouseStatuses(claims);
  return claims.filter((claim) => (statuses.get(claim.id) ?? claim.warehouseStatus) === "NOT_REQUESTED").length;
}

