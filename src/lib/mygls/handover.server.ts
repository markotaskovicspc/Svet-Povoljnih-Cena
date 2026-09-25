import { parcelOrderItemIds } from "@/lib/courier/parcel-contents";
import "server-only";
import { isDeepStrictEqual } from "node:util";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { readPackageHandoverReport } from "@/lib/courier/package-handover";
import {
  readShipmentAssignment,
  sameShipmentAssignment,
} from "@/lib/courier/shipment-assignment";
import { myGlsHandoverReport, type MyGlsHandover } from "./handover";

/** Persist carrier evidence before applying any individual parcel's progress. */
export async function persistMyGlsHandover(shipmentId: string, snapshot: MyGlsHandover) {
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "Shipment" WHERE "id" = ${shipmentId} FOR UPDATE`;
    const shipment = await tx.shipment.findUniqueOrThrow({ where: { id: shipmentId } });
    if (shipment.provider !== "MYGLS" || shipment.packageCount !== snapshot.parcels.length) {
      throw new Error("MyGLS broj paketa se ne poklapa sa pošiljkom.");
    }
    const raw = shipment.rawCreateResponse && typeof shipment.rawCreateResponse === "object" && !Array.isArray(shipment.rawCreateResponse)
      ? shipment.rawCreateResponse : {};
    // Historical scans are durable evidence even if a later API response omits them.
    const previousSnapshot = raw.myGlsParcelHandover as MyGlsHandover | undefined;
    if (previousSnapshot?.version === 1 && Array.isArray(previousSnapshot.parcels)) {
      snapshot = { ...snapshot, parcels: snapshot.parcels.map(parcel => {
        const previous = previousSnapshot.parcels.find(p => p.parcelNumber === parcel.parcelNumber);
        return !parcel.pickedUpAt && previous?.pickedUpAt && Number.isFinite(Date.parse(previous.pickedUpAt))
          ? { ...parcel, pickedUpAt: previous.pickedUpAt } : parcel;
      }), recordedAt: previousSnapshot.recordedAt > snapshot.recordedAt ? previousSnapshot.recordedAt : snapshot.recordedAt };
    }
    const previousReport = readPackageHandoverReport(raw);
    // Explicit warehouse reports remain authoritative until resolved by an operator.
    if (previousReport && previousReport.source !== "MYGLS") return previousReport;
    const report = myGlsHandoverReport(snapshot);
    if (!isDeepStrictEqual(raw.myGlsParcelHandover, snapshot)) {
      await tx.shipment.update({ where: { id: shipment.id }, data: {
        rawCreateResponse: { ...raw, myGlsParcelHandover: snapshot, packageHandover: report } as Prisma.InputJsonValue,
      } });
      await tx.auditLog.create({ data: {
        action: "shipment.mygls-package-handover.sync", entity: "Shipment", entityId: shipment.id,
        diff: { previous: previousReport, report, parcels: snapshot.parcels } as Prisma.InputJsonValue,
      } });
    }
    const assignment = readShipmentAssignment(raw);
    const groupKey = shipment.purpose === "ORDER_DELIVERY"
      ? assignment?.assignmentKey ?? `order:${shipment.orderId}:MYGLS`
      : `reclamation:${shipment.reclamationId}`;
    const batches = await tx.pickupBatch.findMany({ where: {
      provider: "MYGLS", status: { in: ["BOOKED", "PICKED_UP"] },
      lines: { some: { orderId: shipment.orderId, purpose: shipment.purpose, lineGroupKey: groupKey } },
    }, select: { id: true }, orderBy: { id: "asc" } });
    for (const batch of batches) {
      await tx.$queryRaw`SELECT "id" FROM "PickupBatch" WHERE "id" = ${batch.id} FOR UPDATE`;
      const lines = await tx.pickupBatchLine.findMany({ where: {
        batchId: batch.id, orderId: shipment.orderId, purpose: shipment.purpose,
        lineGroupKey: groupKey, deferredAt: null,
      } });
      if (lines.length !== report.expectedPackages) continue;
      if (shipment.purpose === "ORDER_DELIVERY" && !sameShipmentAssignment(
        raw,
        lines.flatMap(parcelOrderItemIds),
        assignment?.assignmentKey,
      )) continue;
      const mapped = lines.every((line) => Boolean(line.providerParcelNumber));
      if (mapped) {
        for (const line of lines) {
          const parcel = snapshot.parcels.find(
            (candidate) => String(candidate.parcelNumber) === line.providerParcelNumber,
          );
          if (!parcel) {
            throw new Error(
              `MyGLS status nema picking paket ${line.providerParcelNumber}.`,
            );
          }
          await tx.pickupBatchLine.update({
            where: { id: line.id },
            data: {
              courierPickedUpAt: parcel.pickedUpAt
                ? new Date(parcel.pickedUpAt)
                : null,
              courierPickedUpById: null,
              providerStatusLabel: parcel.pickedUpAt
                ? "Preuzeto iz magacina"
                : "Čeka preuzimanje",
              providerStatusAt: new Date(report.recordedAt),
            },
          });
        }
      } else {
        const complete = report.pickedUpPackages === report.expectedPackages;
        // Legacy rows predate stable parcel references. They can only be
        // closed as a whole; partial identity must never be guessed by index.
        await tx.pickupBatchLine.updateMany({ where: {
          id: { in: lines.map(line => line.id) }, courierPickedUpById: null,
        }, data: { courierPickedUpAt: complete ? new Date(report.recordedAt) : null } });
      }
      const remaining = await tx.pickupBatchLine.count({ where: {
        batchId: batch.id, courierPickedUpAt: null, deferredAt: null,
      } });
      await tx.pickupBatch.update({ where: { id: batch.id }, data: { status: remaining === 0 ? "PICKED_UP" : "BOOKED" } });
    }
    return report;
  }, { timeout: 30_000 });
}
