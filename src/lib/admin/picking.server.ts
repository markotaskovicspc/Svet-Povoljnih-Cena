import "server-only";
import { isCancelledDelivery } from "@/lib/courier/cancelled-delivery";
import { pickingVolume } from "./picking-volume";
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { readPackedItems } from "@/lib/courier/parcel-contents";
import { buildPickingPlan, type PositionedLine } from "./picking-plan";

type Reader = Pick<Prisma.TransactionClient, "pickupBatch" | "warehousePickingPosition" | "pickingScanEvent" | "adminUser">;
export const pickingLinesQuery = {
    orderBy: { id: "asc" }, include: {
      reclamation: { select: { resolution: true, resolutionNote: true, warehouseId: true, warehouse: { select: { name: true } } } },
      order: { select: { id: true, number: true, status: true, cancelledAt: true, items: { select: {
        id: true, sku: true, name: true, qty: true, warehouseId: true, categoryName: true, color1: true, color2: true,
        warehouse: { select: { name: true } }, product: { select: { barcode: true, supplierId: true } },
      } } } },
    },
} satisfies Prisma.PickupBatch$linesArgs;
type PickingBatch = Pick<Prisma.PickupBatchGetPayload<{ include: { lines: typeof pickingLinesQuery } }>, "id" | "lines">;
function readPickingLines(batch: PickingBatch): PositionedLine[] {
  return batch.lines.flatMap(line => {
    const packed = readPackedItems(line.packedItems);
    const contents = packed.length ? packed : [{ orderItemId: line.orderItemId, quantity: line.packedQuantity }];
    return contents.map(content => {
      const item = line.order.items.find(i => i.id === content.orderItemId);
      // Preserve parcel snapshots for quantities/identity; use live item only for warehouse assignment.
      const snapshot = "sku" in content ? content : null;
      return {
        id: line.id, lineGroupKey: line.lineGroupKey, quantity: line.quantity,
        packedQuantity: content.quantity, deferredAt: line.deferredAt, purpose: line.purpose,
        reclamation: line.reclamation, orderId: line.orderId, orderNumber: line.order.number,
        warehouseId: line.reclamation?.warehouseId ?? item?.warehouseId ?? "", warehouseName: line.reclamation?.warehouse?.name ?? item?.warehouse?.name ?? "Magacin nije određen",
        supplierId: item?.product?.supplierId ?? null,
        orderItem: item ? { ...item, ...(snapshot ? { sku: snapshot.sku, name: snapshot.name, product: { barcode: snapshot.barcode } } : {}) } : null,
      };
    });
  });
}
function hashPickingLines(lines: PositionedLine[]) {
  return createHash("sha256").update(JSON.stringify(lines)).digest("hex");
}

export async function getPickingSession(batchId: string, client: Reader = db) {
  const batch = await client.pickupBatch.findUnique({ where: { id: batchId }, include: { lines: pickingLinesQuery } });
  if (!batch) throw new Error("Picking nalog nije pronađen.");
  const lines = readPickingLines(batch);
  const cancelledOrders = [...new Map(batch.lines.filter(line => !line.deferredAt && isCancelledDelivery(line)).map(line => [line.orderId, { id: line.orderId, number: line.order.number }])).values()];
  const positions = await client.warehousePickingPosition.findMany({ where: { warehouseId: { in: [...new Set(lines.map(l => l.warehouseId).filter(Boolean))] } } });
  const rows = buildPickingPlan(lines, positions);
  // Positions may be corrected without losing progress. Any parcel/allocation/content change requires a fresh check.
  const planHash = hashPickingLines(lines);
  const events = await client.pickingScanEvent.findMany({ where: { batchId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
  const actors = await client.adminUser.findMany({ where: { id: { in: [...new Set(events.slice(0, 100).map(e => e.actorId))] } }, select: { id: true, firstName: true, lastName: true, email: true } });
  const progress: Record<string, number> = {};
  for (const event of events) if (event.planHash === planHash) progress[event.rowKey] = (progress[event.rowKey] ?? 0) + event.delta;
  return {
    id: batch.id, number: batch.number, planHash, rows, progress,
    labelsReady: Boolean(batch.labelsCreatedAt),
    cancelledOrders,
    labelsPreparationAllowed: batch.status === "DRAFT" && !cancelledOrders.length,
    reviewedRows: [...new Set(events.filter(e => e.planHash === planHash && (e.delta > 0 || e.note.startsWith("Potvrđena količina:"))).map(e => e.rowKey))],
    volume: pickingVolume(batch.lines),
    editable: batch.status === "DRAFT" && !batch.labelsCreationStartedAt && !batch.labelsCreatedAt,
    previousPlan: events.some(e => e.planHash !== planHash),
    events: events.slice(0, 100).map(e => ({ ...e, createdAt: e.createdAt.toISOString(), actorName: actors.filter(a => a.id === e.actorId).map(a => [a.firstName, a.lastName].filter(Boolean).join(" ") || a.email)[0] ?? e.actorId })),
  };
}

/** All list cards in one event query; ignore scans for obsolete parcel contents. */
export async function getPickingBatchProgress(batches: PickingBatch[], client: Pick<Reader, "pickingScanEvent"> = db) {
  if (!batches.length) return new Map<string, { done: number; total: number; status: "empty" | "partial" | "complete" }>();
  const events = await client.pickingScanEvent.findMany({
    where: { batchId: { in: batches.map(batch => batch.id) } },
    select: { batchId: true, planHash: true, rowKey: true, delta: true },
  });
  const grouped = new Map<string, typeof events>();
  for (const event of events) {
    const list = grouped.get(event.batchId) ?? [];
    list.push(event); grouped.set(event.batchId, list);
  }
  return new Map(batches.map(batch => {
    const lines = readPickingLines(batch), planHash = hashPickingLines(lines);
    const rows = buildPickingPlan(lines, []);
    const progress: Record<string, number> = {};
    for (const event of grouped.get(batch.id) ?? []) {
      if (event.planHash === planHash) progress[event.rowKey] = (progress[event.rowKey] ?? 0) + event.delta;
    }
    const total = rows.reduce((sum, row) => sum + row.quantity, 0);
    const done = rows.reduce((sum, row) => sum + Math.max(0, Math.min(row.quantity, progress[row.key] ?? 0)), 0);
    const status = total > 0 && done === total ? "complete" : done > 0 ? "partial" : "empty";
    return [batch.id, { done, total, status }] as const;
  }));
}
