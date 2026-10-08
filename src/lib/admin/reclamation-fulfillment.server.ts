import { reclamationParcelQuantity } from "./return-receipt-plan";
import { normalizeReturnParcelNumber, returnParcelArrived, returnParcelNumbers } from "./return-parcels";
import { assertReturnNotLost } from "./return-resolution.server";
import { assertMyGlsReturnAccepted, canReceiveReclamationShipment } from "@/lib/mygls/return-booking";
import "server-only";
import type { XExpressPickupCoordinates } from "@/lib/x-express/return";
import { announceXExpressShipment } from "@/lib/x-express/shipments";

import type {
  ReclamationWarehouseStatus,
  ShipmentPurpose,
} from "@prisma/client";
import { Prisma, StockMovementKind } from "@prisma/client";
import { db } from "@/lib/db";
import { adjustInventory, ensureDefaultWarehouse } from "@/lib/inventory";
import { lockOrderReturn } from "@/lib/fiscal/return-lock";
import { returnedStockBalance } from "@/lib/fiscal/return-stock";
import {
  createShipmentForOrder,
  preflightShipmentForOrder,
} from "@/lib/courier/registry";
import type { PhysicalPackage } from "@/lib/courier/packages";
import { deleteMyGlsLabelsForShipment, ensureMyGlsReturnDocument } from "@/lib/mygls/shipments";
import {
  MYGLS_PROVIDER,
  type SmallParcelProvider,
} from "@/lib/mygls/config";

import { parseReclamationPackages } from "@/lib/admin/reclamation-packages";

const RECLAMATION_PURPOSES: ShipmentPurpose[] = [
  "RECLAMATION_RETURN",
  "RECLAMATION_REPLACEMENT",
];

type ReclamationShipmentOptions = {
  reclamationId: string;
  purpose: ShipmentPurpose;
  returnPickupCoordinates?: XExpressPickupCoordinates;
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
  status?: ReclamationWarehouseStatus;
  packages?: unknown;
  actorId?: string;
}) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Reclamation" WHERE "id" = ${args.reclamationId} FOR UPDATE`;
    const reclamation = await tx.reclamation.findUniqueOrThrow({
      where: { id: args.reclamationId },
      include: {
        pickupBatchLines: { where: { purpose: "RECLAMATION_REPLACEMENT" }, take: 1 },
        shipments: { where: { purpose: "RECLAMATION_REPLACEMENT", status: { not: "FAILED" } }, take: 1 },
      },
    });
    if (reclamation.pickupBatchLines.length || reclamation.shipments.length) {
      throw new Error("Zamena je već u picking nalogu ili kod kurira. Uklonite je iz otključanog picking naloga pre izmene pripreme.");
    }
    const warehouse = await tx.warehouse.findFirst({
      where: { id: args.warehouseId, active: true }, select: { id: true },
    });
    if (!warehouse) throw new Error("Izabrani magacin nije aktivan.");
    const isReplacement = ["ZAMENA_ARTIKLA", "ZAMENA_DELA"].includes(reclamation.resolution ?? "");
    const status = args.status ?? "READY";
    const ready = isReplacement && status === "READY";
    if (ready && reclamation.decision !== "PRIHVACENA") {
      throw new Error("Pre potvrde spremnosti sačuvajte prihvaćenu odluku o zameni.");
    }
    if (ready && reclamation.resolution === "ZAMENA_DELA" && !reclamation.resolutionNote?.trim()) {
      throw new Error("Upišite tačan naziv dela koji magacin treba da pošalje.");
    }
    const packages = isReplacement && (ready || args.packages != null)
      ? parseReclamationPackages(args.packages ?? reclamation.replacementPackages)
      : undefined;
    return tx.reclamation.update({
      where: { id: args.reclamationId },
      data: {
        warehouseId: warehouse.id,
        warehouseStatus: status,
        warehouseRequestedAt: status === "NOT_REQUESTED" ? null : new Date(),
        replacementPackages: packages,
        replacementReadyAt: ready ? new Date() : null,
        replacementReadyById: ready ? args.actorId ?? null : null,
      },
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10_000, timeout: 30_000 });
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
        select: { status: true, provider: true, purpose: true, providerParcelId: true, trackingNo: true, syncError: true, rawCreateResponse: true },
        take: 1,
      },
    },
  });
  if (!reclamation) throw new Error("Reklamacija nije pronađena.");
  if (reclamation.shipments[0]?.status !== "FAILED" && reclamation.shipments[0]) {
    assertMyGlsReturnAccepted(reclamation.shipments[0]);
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
    returnPickupCoordinates: args.returnPickupCoordinates,
    codAmount: 0,
  });
}

export async function createReclamationShipment(args: ReclamationShipmentOptions) {
  assertReclamationPurpose(args.purpose);
  const reclamation = await db.reclamation.findUnique({
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
      replacementQty: true,
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
  if (!existing || existing.status === "FAILED") {
    assertReclamationShipmentReady(reclamation, args);
  }

  // Provider creation performs its own Prisma reads and writes. It must not run
  // inside an interactive transaction: production intentionally uses a
  // one-connection pool, so a nested client query would wait on the connection
  // held by its parent transaction until `timeout exceeded when trying to
  // connect`. Provider I/O also must not keep a database transaction open.
  let shipment =
    existing && existing.status !== "FAILED"
      ? existing
      : await createShipmentForOrder(reclamation.orderId, {
          purpose: args.purpose,
          reclamationId: reclamation.id,
          packageCount: args.packageCount,
          packages: args.packages,
          pickupDate: args.pickupDate,
          provider: args.provider,
          returnPickupCoordinates: args.returnPickupCoordinates,
          codAmount: 0,
        });

  if (args.purpose === "RECLAMATION_RETURN" && shipment.provider === MYGLS_PROVIDER) {
    assertMyGlsReturnAccepted(shipment);
    if (!shipment.labelObjectKey) shipment = await ensureMyGlsReturnDocument(shipment);
  }

  if (args.purpose === "RECLAMATION_RETURN" && shipment.provider === "X_EXPRESS" && !shipment.providerShipmentId) {
    if (shipment.providerStatusCode === "LOCAL_PREPARED") {
      shipment = await announceXExpressShipment(shipment.id);
    } else {
      // An earlier request may have reached the courier even if its response
      // was lost. Do not claim a booking or automatically send it again.
      throw new Error("X Express još nije potvrdio preuzimanje. Proverite postojeći broj pošiljke kod kurira pre ponovnog slanja.");
    }
  }

  await db.$transaction(async (tx) => {
    if (
      args.purpose === "RECLAMATION_REPLACEMENT" &&
      reclamation.resolution === "ZAMENA_ARTIKLA"
    ) {
      if (!reclamation.productId || !reclamation.warehouseId) {
        throw new Error("Zamenski artikal nema vezan proizvod ili magacin.");
      }
      const replacementQty =
        reclamation.replacementQty ?? reclamation.quantity;
      if (replacementQty < 1) {
        throw new Error("Količina celih zamenskih artikala nije ispravna.");
      }
      await adjustInventory(tx, {
        idempotencyKey: `reclamation-replacement:${reclamation.id}:out`,
        productId: reclamation.productId,
        sku: reclamation.sku,
        qtyDelta: -replacementQty,
        warehouseId: reclamation.warehouseId,
        kind: StockMovementKind.ADJUSTMENT,
        note: `Izdavanje ${replacementQty} zamenskih artikala po reklamaciji ${reclamation.id}.`,
        actorId: args.actorId,
        orderId: reclamation.orderId,
        orderItemId: reclamation.orderItemId,
      });
    }

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
  }, { maxWait: 10_000, timeout: 30_000 });

  return shipment;
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
    if (!args.fromPickupBatch) {
      throw new Error(
        "Zamena mora biti učitana u picking nalog i poslata knjiženjem tog naloga.",
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
          replacementQty: true,
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
        qtyDelta:
          shipment.reclamation!.replacementQty ??
          shipment.reclamation!.quantity,
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
  parcelNumber?: string;
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
          include: { returnArrivals: true },
        },
      },
    });
    if (!reclamation) throw new Error("Reklamacija nije pronađena.");
    const shipment = reclamation.shipments[0];
    if (!shipment) throw new Error("Povratna pošiljka nije pronađena.");
    const code = args.parcelNumber ? normalizeReturnParcelNumber(args.parcelNumber) : null;
    const numbers = returnParcelNumbers(shipment);
    const physicalReceipt = code ? returnParcelArrived(shipment, code) :
      numbers.length === shipment.packageCount && numbers.every(number => returnParcelArrived(shipment, number));
    if (!physicalReceipt && !canReceiveReclamationShipment(shipment)) {
      throw new Error("Potvrdite fizički dolazak paketa ili osvežite potvrdu kurira.");
    }
    const parcelQty = code ? reclamationParcelQuantity(shipment, {
      id: reclamation.orderItemId ?? "", sku: reclamation.sku, qty: reclamation.quantity,
    }, code) : null;
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
    if (!warehouse?.active) {
      throw new Error("Izaberite aktivan magacin za prijem pregledane robe.");
    }
    await lockOrderReturn(tx, reclamation.orderId);
    await assertReturnNotLost(tx, `reclamation:${reclamation.id}`);
    const aggregateKey = `reclamation-return:${reclamation.id}`;
    const key = code ? `${aggregateKey}:parcel:${code}` : aggregateKey;
    const [aggregateReceipt, parcelReceipts] = await Promise.all([
      tx.stockMovement.findUnique({ where: { idempotencyKey: aggregateKey } }),
      tx.stockMovement.findMany({ where: { idempotencyKey: { startsWith: `${aggregateKey}:parcel:` } } }),
    ]);
    const existingReceipt = aggregateReceipt ?? parcelReceipts.find(row => row.idempotencyKey === key);
    if (existingReceipt) return { movement: existingReceipt, warehouse };
    const receivedQty = parcelReceipts.reduce((sum, row) => sum + row.qty, 0);
    const quantity = parcelQty ?? reclamation.quantity - receivedQty;
    if (quantity <= 0 || receivedQty + quantity > reclamation.quantity) throw new Error("Povrat je već primljen ili količina prelazi reklamaciju.");
    if (reclamation.orderItemId) {
      const balance = await returnedStockBalance(tx, reclamation.orderItemId);
      if (balance.refunded > 0) {
        throw new Error("Artikal već ima fiskalnu refundaciju i vraćeno stanje. Proverite postojeće knjiženje pre prijema reklamacije da se lager ne uveća dvaput.");
      }
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
      idempotencyKey: key,
      productId: reclamation.productId,
      sku: reclamation.sku,
      qtyDelta: quantity,
      warehouseId: warehouse.id,
      kind: StockMovementKind.REFUND_RETURN,
      note: `Povrat po reklamaciji ${reclamation.number}${code ? `, paket ${code}` : ""} primljen u ${warehouse.code} · ${warehouse.name}.`,
      actorId: args.actorId,
      orderId: reclamation.orderId,
      orderItemId: reclamation.orderItemId,
    });
    await tx.reclamation.update({
      where: { id: reclamation.id },
      data: {
        warehouseId: warehouse.id,
        warehouseStatus: receivedQty + quantity === reclamation.quantity ? "READY" : undefined,
        status: reclamation.status === "PRIMLJENO" ? "U_OBRADI" : undefined,
      },
    });
    return { movement, warehouse };
  }, { maxWait: 10_000, timeout: 30_000 });
}
