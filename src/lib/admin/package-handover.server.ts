import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { normalizeOrderItemIds, readShipmentAssignment } from "@/lib/courier/shipment-assignment";
import { packageHandoverLabel, readPackageHandoverReport, type PackageHandoverReport } from "@/lib/courier/package-handover";

/** Record a known count without inventing which parcel was physically taken. */
export async function recordPackageHandover(args: {
  orderId: string;
  shipmentId: string;
  pickedUpPackages: number;
  note: string;
  actorId: string | null;
}) {
  const note = args.note.trim();
  if (!note || note.length > 1000) throw new Error("Unesite napomenu do 1000 znakova.");
  if (!Number.isInteger(args.pickedUpPackages) || args.pickedUpPackages < 0) {
    throw new Error("Unesite ceo broj fizički preuzetih paketa.");
  }
  return db.$transaction(async (tx) => {
    // Keep the report and carrier reconciliation serialized on the shipment.
    await tx.$queryRaw`SELECT "id" FROM "Shipment" WHERE "id" = ${args.shipmentId} FOR UPDATE`;
    const shipment = await tx.shipment.findUniqueOrThrow({
      where: { id: args.shipmentId }, include: { order: { select: { status: true } } },
    });
    if (shipment.orderId !== args.orderId || shipment.provider !== "X_EXPRESS" || shipment.purpose !== "ORDER_DELIVERY") {
      throw new Error("X Express nalog za ovu porudžbinu nije pronađen.");
    }
    if (args.pickedUpPackages > shipment.packageCount) throw new Error("Preuzeta količina ne može biti veća od broja prijavljenih paketa.");
    const raw = shipment.rawCreateResponse && typeof shipment.rawCreateResponse === "object" && !Array.isArray(shipment.rawCreateResponse)
      ? shipment.rawCreateResponse : {};
    const previous = readPackageHandoverReport(raw);
    if (previous?.pickedUpPackages === args.pickedUpPackages && previous.note === note && previous.expectedPackages === shipment.packageCount) return previous;
    const report: PackageHandoverReport = {
      version: 1, expectedPackages: shipment.packageCount, pickedUpPackages: args.pickedUpPackages,
      recordedAt: new Date().toISOString(), note, source: args.actorId ? "ADMIN" : "USER_REPORT",
    };
    await tx.shipment.update({ where: { id: shipment.id }, data: {
      rawCreateResponse: { ...raw, packageHandover: report } as Prisma.InputJsonValue,
    } });
    const assignment = readShipmentAssignment(raw);
    const batches = await tx.pickupBatch.findMany({
      where: { provider: shipment.provider, status: { in: ["BOOKED", "PICKED_UP"] }, lines: { some: { orderId: shipment.orderId } } },
      select: { id: true }, orderBy: { id: "asc" },
    });
    for (const batch of batches) {
      await tx.$queryRaw`SELECT "id" FROM "PickupBatch" WHERE "id" = ${batch.id} FOR UPDATE`;
      const lines = await tx.pickupBatchLine.findMany({ where: {
        batchId: batch.id, orderId: shipment.orderId, purpose: "ORDER_DELIVERY",
        lineGroupKey: `order:${shipment.orderId}:${shipment.provider}`,
      }, select: { id: true, orderItemId: true, courierPickedUpById: true } });
      const itemIds = normalizeOrderItemIds(lines.flatMap(line => line.orderItemId ? [line.orderItemId] : []));
      if (assignment && (itemIds.length !== assignment.orderItemIds.length || !itemIds.every(id => assignment.orderItemIds.includes(id)))) continue;
      if (lines.length !== report.expectedPackages) continue;
      const complete = report.pickedUpPackages === report.expectedPackages;
      await tx.pickupBatchLine.updateMany({ where: {
        id: { in: lines.map(line => line.id) },
        // A count-only report must not erase an individually signed handover.
        ...(complete ? {} : { courierPickedUpById: null }),
      }, data: {
        courierPickedUpAt: complete ? new Date(report.recordedAt) : null,
        courierPickedUpById: complete ? args.actorId : null,
      } });
      const remaining = await tx.pickupBatchLine.count({ where: { batchId: batch.id, courierPickedUpAt: null } });
      await tx.pickupBatch.update({ where: { id: batch.id }, data: { status: remaining === 0 ? "PICKED_UP" : "BOOKED" } });
    }
    const message = `${packageHandoverLabel(report)}. ${note}`;
    await tx.orderStatusEvent.create({ data: { orderId: shipment.orderId, status: shipment.order.status, note: message } });
    await tx.auditLog.create({ data: {
      actorId: args.actorId, action: "shipment.package-handover.record", entity: "Shipment", entityId: shipment.id,
      diff: { orderId: shipment.orderId, previous, report } as Prisma.InputJsonValue,
    } });
    return report;
  }, { timeout: 30_000 });
}
