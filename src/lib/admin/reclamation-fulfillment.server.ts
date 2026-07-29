import "server-only";

import type {
  ReclamationWarehouseStatus,
  ShipmentPurpose,
} from "@prisma/client";
import { db } from "@/lib/db";
import { createShipmentForOrder } from "@/lib/courier/registry";
import { deleteMyGlsLabelsForShipment } from "@/lib/mygls/shipments";
import { MYGLS_PROVIDER } from "@/lib/mygls/config";

const RECLAMATION_PURPOSES: ShipmentPurpose[] = [
  "RECLAMATION_RETURN",
  "RECLAMATION_REPLACEMENT",
];

export async function saveReclamationWarehouse(args: {
  reclamationId: string;
  warehouseId: string;
  status: ReclamationWarehouseStatus;
}) {
  const warehouse = await db.warehouse.findFirst({
    where: { id: args.warehouseId, active: true },
    select: { id: true },
  });
  if (!warehouse) throw new Error("Izabrani magacin nije aktivan.");

  return db.reclamation.update({
    where: { id: args.reclamationId },
    data: {
      warehouseId: warehouse.id,
      warehouseStatus: args.status,
      warehouseRequestedAt:
        args.status === "NOT_REQUESTED" ? null : new Date(),
    },
  });
}

export async function createReclamationShipment(args: {
  reclamationId: string;
  purpose: ShipmentPurpose;
  packageCount?: number;
}) {
  if (!RECLAMATION_PURPOSES.includes(args.purpose)) {
    throw new Error("Nepoznata svrha reklamacionе pošiljke.");
  }

  const lockKey = `reclamation-shipment:${args.reclamationId}:${args.purpose}`;
  return db.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
      const reclamation = await tx.reclamation.findUnique({
        where: { id: args.reclamationId },
        select: {
          id: true,
          orderId: true,
          decision: true,
          resolution: true,
          warehouseId: true,
          warehouseStatus: true,
          shipments: {
            where: { purpose: args.purpose },
            orderBy: { createdAt: "desc" },
            take: 1,
          },
        },
      });
      if (!reclamation) throw new Error("Reklamacija nije pronađena.");
      const existing = reclamation.shipments[0];
      if (existing && existing.status !== "FAILED") return existing;
      if (reclamation.decision !== "PRIHVACENA") {
        throw new Error("Kurirski nalog se kreira tek posle prihvatanja reklamacije.");
      }
      if (!reclamation.warehouseId) {
        throw new Error("Izaberite magacin pre kreiranja kurirskog naloga.");
      }
      if (
        args.purpose === "RECLAMATION_REPLACEMENT" &&
        !["ZAMENA_ARTIKLA", "ZAMENA_DELA"].includes(reclamation.resolution ?? "")
      ) {
        throw new Error("Za zamensku pošiljku izaberite zamenu artikla ili dela.");
      }
      if (
        args.purpose === "RECLAMATION_REPLACEMENT" &&
        reclamation.warehouseStatus !== "READY"
      ) {
        throw new Error("Zamena mora imati status „Spremno” pre predaje kuriru.");
      }

      const shipment = await createShipmentForOrder(reclamation.orderId, {
        purpose: args.purpose,
        reclamationId: reclamation.id,
        packageCount: args.packageCount,
      });
      await tx.reclamation.update({
        where: { id: reclamation.id },
        data: {
          courierRequestedAt: new Date(),
          warehouseRequestedAt:
            reclamation.warehouseStatus === "NOT_REQUESTED"
              ? new Date()
              : undefined,
          warehouseStatus:
            reclamation.warehouseStatus === "NOT_REQUESTED"
              ? "REQUESTED"
              : undefined,
        },
      });
      return shipment;
    },
    { maxWait: 10_000, timeout: 60_000 },
  );
}

export async function cancelReclamationShipment(shipmentId: string) {
  const shipment = await db.shipment.findUnique({
    where: { id: shipmentId },
    select: {
      id: true,
      purpose: true,
      provider: true,
      status: true,
    },
  });
  if (!shipment || shipment.purpose === "ORDER_DELIVERY") {
    throw new Error("Reklamaciona pošiljka nije pronađena.");
  }
  if (["DELIVERED", "RETURNED"].includes(shipment.status)) {
    throw new Error("Završena pošiljka ne može da se otkaže.");
  }
  if (shipment.provider !== MYGLS_PROVIDER) {
    throw new Error(
      "Provajder nema ugovoren API za otkazivanje; nalog nije promenjen.",
    );
  }
  await deleteMyGlsLabelsForShipment(shipment.id);
  return db.shipment.findUniqueOrThrow({ where: { id: shipment.id } });
}
