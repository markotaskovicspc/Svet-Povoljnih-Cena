import "server-only";
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { readPackedItems } from "@/lib/courier/parcel-contents";
import { buildPickingPlan, type PositionedLine } from "./picking-plan";

type Reader = Pick<Prisma.TransactionClient, "pickupBatch" | "warehousePickingPosition" | "pickingScanEvent" | "adminUser">;
export async function getPickingSession(batchId: string, client: Reader = db) {
  const batch = await client.pickupBatch.findUnique({ where: { id: batchId }, include: { lines: {
    orderBy: { id: "asc" }, include: {
      reclamation: { select: { resolution: true, resolutionNote: true, warehouseId: true, warehouse: { select: { name: true } } } },
      order: { select: { id: true, number: true, status: true, items: { select: {
        id: true, sku: true, name: true, qty: true, warehouseId: true, categoryName: true, color1: true, color2: true,
        warehouse: { select: { name: true } }, product: { select: { barcode: true, supplierId: true } },
      } } } },
    },
  } } });
  if (!batch) throw new Error("Picking nalog nije pronađen.");
  const lines: PositionedLine[] = batch.lines.flatMap(line => {
    if (line.order.status === "OTKAZANO") return [];
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
  const positions = await client.warehousePickingPosition.findMany({ where: { warehouseId: { in: [...new Set(lines.map(l => l.warehouseId).filter(Boolean))] } } });
  const rows = buildPickingPlan(lines, positions);
  // Positions may be corrected without losing progress. Any parcel/allocation/content change requires a fresh check.
  const planHash = createHash("sha256").update(JSON.stringify(lines)).digest("hex");
  const events = await client.pickingScanEvent.findMany({ where: { batchId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
  const actors = await client.adminUser.findMany({ where: { id: { in: [...new Set(events.slice(0, 100).map(e => e.actorId))] } }, select: { id: true, firstName: true, lastName: true, email: true } });
  const progress: Record<string, number> = {};
  for (const event of events) if (event.planHash === planHash) progress[event.rowKey] = (progress[event.rowKey] ?? 0) + event.delta;
  return {
    id: batch.id, number: batch.number, planHash, rows, progress,
    editable: batch.status === "DRAFT" && !batch.labelsCreationStartedAt && !batch.labelsCreatedAt,
    previousPlan: events.some(e => e.planHash !== planHash),
    events: events.slice(0, 100).map(e => ({ ...e, createdAt: e.createdAt.toISOString(), actorName: actors.filter(a => a.id === e.actorId).map(a => [a.firstName, a.lastName].filter(Boolean).join(" ") || a.email)[0] ?? e.actorId })),
  };
}
