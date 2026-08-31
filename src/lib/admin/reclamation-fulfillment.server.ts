import "server-only";

import type {
  ReclamationWarehouseStatus,
  ShipmentPurpose,
} from "@prisma/client";
import { StockMovementKind } from "@prisma/client";
import { db } from "@/lib/db";
import { adjustInventory, ensureDefaultWarehouse } from "@/lib/inventory";
import {
  createShipmentForOrder,
  preflightShipmentForOrder,
} from "@/lib/courier/registry";
import type { PhysicalPackage } from "@/lib/courier/packages";
import { deleteMyGlsLabelsForShipment } from "@/lib/mygls/shipments";
import {
  MYGLS_PROVIDER,
  type SmallParcelProvider,
} from "@/lib/mygls/config";
import { isReturnWarehouse } from "@/lib/admin/return-warehouse";

const RECLAMATION_PURPOSES: ShipmentPurpose[] = [
  "RECLAMATION_RETURN",
  "RECLAMATION_REPLACEMENT",
];

type ReclamationShipmentOptions = {
  reclamationId: string;
  purpose: ShipmentPurpose;
  packageCount?: number;
  packages?: readonly PhysicalPackage[];
  pickupDate?: Date;
  provider?: SmallParcelProvider;
  fromPickupBatch?: boolean;
  actorId?: string | null;
};

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

export async function preflightReclamationShipment(
  args: ReclamationShipmentOptions,
) {
  assertReclamationPurpose(args.purpose);
  const reclamation = await db.reclamation.findUnique({
    where: { id: args.reclamationId },
    select: {
      id: true,
      orderId: true,
      decision: true,
      resolution: true,
      warehouseId: true,
      warehouseStatus: true,
      pickupBatchLines: {
        where: { purpose: args.purpose },
        select: { batchId: true },
        take: 1,
      },
      shipments: {
        where: { purpose: args.purpose },
        orderBy: { createdAt: "desc" },
        select: { status: true },
        take: 1,
      },
    },
  });
  if (!reclamation) throw new Error("Reklamacija nije pronađena.");
  if (reclamation.shipments[0]?.status !== "FAILED" && reclamation.shipments[0]) {
    return;
  }
  assertReclamationShipmentReady(reclamation, args);
  await preflightShipmentForOrder(reclamation.orderId, {
    purpose: args.purpose,
    reclamationId: reclamation.id,
    packageCount: args.packageCount,
    packages: args.packages,
    pickupDate: args.pickupDate,
    provider: args.provider,
    codAmount: 0,
  });
}

export async function createReclamationShipment(args: ReclamationShipmentOptions) {
  assertReclamationPurpose(args.purpose);

  const lockKey = `reclamation-shipment:${args.reclamationId}:${args.purpose}`;
  return db.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))::text AS "lock"`;
      const reclamation = await tx.reclamation.findUnique({
        where: { id: args.reclamationId },
        select: {
          id: true,
          orderId: true,
          decision: true,
          resolution: true,
          productId: true,
          orderItemId: true,
          sku: true,
          quantity: true,
          warehouseId: true,
          warehouseStatus: true,
          pickupBatchLines: {
            where: { purpose: args.purpose },
            select: { batchId: true },
            take: 1,
          },
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
      assertReclamationShipmentReady(reclamation, args);

      if (
        args.purpose === "RECLAMATION_REPLACEMENT" &&
        reclamation.resolution === "ZAMENA_ARTIKLA"
      ) {
        if (!reclamation.productId || !reclamation.warehouseId) {
          throw new Error("Zamenski artikal nema vezan proizvod ili magacin.");
        }
        await adjustInventory(tx, {
          idempotencyKey: `reclamation-replacement:${reclamation.id}:out`,
          productId: reclamation.productId,
          sku: reclamation.sku,
          qtyDelta: -reclamation.quantity,
          warehouseId: reclamation.warehouseId,
          kind: StockMovementKind.ADJUSTMENT,
          note: `Izdavanje zamenskog artikla po reklamaciji ${reclamation.id}.`,
          actorId: args.actorId,
          orderId: reclamation.orderId,
          orderItemId: reclamation.orderItemId,
        });
      }

      const shipment = await createShipmentForOrder(reclamation.orderId, {
        purpose: args.purpose,
        reclamationId: reclamation.id,
        packageCount: args.packageCount,
        packages: args.packages,
        pickupDate: args.pickupDate,
        provider: args.provider,
        codAmount: 0,
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
            args.purpose === "RECLAMATION_REPLACEMENT"
              ? "HANDED_OVER"
              : reclamation.warehouseStatus === "NOT_REQUESTED"
              ? "REQUESTED"
              : undefined,
        },
      });
      return shipment;
    },
    { maxWait: 10_000, timeout: 60_000 },
  );
}

function assertReclamationPurpose(purpose: ShipmentPurpose) {
  if (!RECLAMATION_PURPOSES.includes(purpose)) {
    throw new Error("Nepoznata svrha reklamacione pošiljke.");
  }
}

function assertReclamationShipmentReady(
  reclamation: {
    decision: string | null;
    resolution: string | null;
    warehouseId: string | null;
    warehouseStatus: ReclamationWarehouseStatus;
    pickupBatchLines: readonly { batchId: string }[];
  },
  args: Pick<ReclamationShipmentOptions, "purpose" | "fromPickupBatch">,
) {
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
  if (args.purpose === "RECLAMATION_REPLACEMENT") {
    const queued = Boolean(reclamation.pickupBatchLines[0]);
    if (queued && !args.fromPickupBatch) {
      throw new Error(
        "Zamena je u picking nalogu i mora se poslati knjiženjem tog naloga.",
      );
    }
    if (!queued && args.fromPickupBatch) {
      throw new Error("Zamena više nije povezana sa picking nalogom.");
    }
  }
}

export async function cancelReclamationShipment(
  shipmentId: string,
  actorId?: string | null,
) {
  const shipment = await db.shipment.findUnique({
    where: { id: shipmentId },
    select: {
      id: true,
      purpose: true,
      provider: true,
      status: true,
      reclamation: {
        select: {
          id: true,
          number: true,
          orderId: true,
          orderItemId: true,
          productId: true,
          sku: true,
          quantity: true,
          warehouseId: true,
          resolution: true,
        },
      },
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
  if (
    shipment.purpose === "RECLAMATION_REPLACEMENT" &&
    shipment.reclamation?.resolution === "ZAMENA_ARTIKLA" &&
    shipment.reclamation.productId &&
    shipment.reclamation.warehouseId
  ) {
    await db.$transaction(async (tx) => {
      const issued = await tx.stockMovement.findUnique({
        where: {
          idempotencyKey: `reclamation-replacement:${shipment.reclamation!.id}:out`,
        },
        select: { id: true },
      });
      if (!issued) return;
      await adjustInventory(tx, {
        idempotencyKey: `reclamation-replacement:${shipment.reclamation!.id}:restore`,
        productId: shipment.reclamation!.productId!,
        sku: shipment.reclamation!.sku,
        qtyDelta: shipment.reclamation!.quantity,
        warehouseId: shipment.reclamation!.warehouseId!,
        kind: StockMovementKind.ADJUSTMENT,
        note: `Vraćena rezerva zamenskog artikla posle otkazivanja reklamacije ${shipment.reclamation!.number}.`,
        actorId,
        orderId: shipment.reclamation!.orderId,
        orderItemId: shipment.reclamation!.orderItemId,
      });
      await tx.reclamation.update({
        where: { id: shipment.reclamation!.id },
        data: { warehouseStatus: "READY" },
      });
    });
  }
  return db.shipment.findUniqueOrThrow({ where: { id: shipment.id } });
}

export async function receiveReclamationReturn(args: {
  reclamationId: string;
  warehouseId: string;
  actorId: string;
}) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`reclamation-return-receipt:${args.reclamationId}`}))::text AS "lock"`;
    const reclamation = await tx.reclamation.findUnique({
      where: { id: args.reclamationId },
      include: {
        shipments: {
          where: { purpose: "RECLAMATION_RETURN" },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    });
    if (!reclamation) throw new Error("Reklamacija nije pronađena.");
    const shipment = reclamation.shipments[0];
    if (!shipment || !["DELIVERED", "RETURNED"].includes(shipment.status)) {
      throw new Error("Povrat može da se primi tek kada kurir potvrdi isporuku u magacin.");
    }
    if (!reclamation.productId) {
      throw new Error("Reklamacija nema vezan artikal i ne može da se proknjiži na lager.");
    }
    const warehouse = await tx.warehouse.findFirst({
      where: { id: args.warehouseId },
      select: {
        id: true,
        code: true,
        name: true,
        active: true,
        isDefault: true,
      },
    });
    if (!warehouse || !isReturnWarehouse(warehouse)) {
      throw new Error("Izaberite aktivan magacin oštećene/povratne robe, ne glavni DC.");
    }
    const represented = await tx.warehouseStock.findFirst({
      where: { productId: reclamation.productId },
      select: { id: true },
    });
    if (!represented) {
      const defaultWarehouse = await ensureDefaultWarehouse(tx);
      const product = await tx.product.findUnique({
        where: { id: reclamation.productId },
        select: { stock: true },
      });
      if (!product) throw new Error("Artikal više ne postoji.");
      await tx.warehouseStock.create({
        data: {
          warehouseId: defaultWarehouse.id,
          productId: reclamation.productId,
          qty: product.stock,
        },
      });
    }
    const movement = await adjustInventory(tx, {
      idempotencyKey: `reclamation-return:${reclamation.id}`,
      productId: reclamation.productId,
      sku: reclamation.sku,
      qtyDelta: reclamation.quantity,
      warehouseId: warehouse.id,
      kind: StockMovementKind.REFUND_RETURN,
      note: `Povrat po reklamaciji ${reclamation.number} primljen u ${warehouse.code} · ${warehouse.name}.`,
      actorId: args.actorId,
      orderId: reclamation.orderId,
      orderItemId: reclamation.orderItemId,
    });
    await tx.reclamation.update({
      where: { id: reclamation.id },
      data: {
        warehouseId: warehouse.id,
        warehouseStatus: "READY",
        status: reclamation.status === "PRIMLJENO" ? "U_OBRADI" : undefined,
      },
    });
    return { movement, warehouse };
  }, { maxWait: 10_000, timeout: 30_000 });
}
