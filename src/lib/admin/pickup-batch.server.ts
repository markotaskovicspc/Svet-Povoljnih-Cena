import "server-only";

import {
  Prisma,
  type PickupBatchStatus,
  type ShipmentPurpose,
} from "@prisma/client";
import { db } from "@/lib/db";
import {
  createShipmentForOrder,
  getSelectedSmallParcelProvider,
} from "@/lib/courier";
import {
  derivePhysicalPackages,
  hasKnownMyGlsHardLimitViolation,
  hasKnownMyGlsOversizeSurcharge,
  requireCompletePhysicalPackages,
  requireCompleteXExpressPackages,
  requireCompleteMyGlsPackages,
  type PhysicalPackage,
} from "@/lib/courier/packages";
import { resolveCourierProvider } from "@/lib/courier/routing";
import {
  readShipmentAssignment,
  sameShipmentAssignment,
  splitAmountByWeights,
} from "@/lib/courier/shipment-assignment";
import {
  getMyGlsConfig,
  MYGLS_PROVIDER,
  requireMyGlsEnabled,
  type SmallParcelProvider,
} from "@/lib/mygls/config";
import { usableMyGlsLabelWhere } from "@/lib/mygls/labels";
import { deleteMyGlsLabelsForShipment } from "@/lib/mygls/shipments";
import {
  requireXExpressShipmentConfig,
  X_EXPRESS_PROVIDER,
} from "@/lib/x-express/config";
import { announceXExpressShipment } from "@/lib/x-express/shipments";
import {
  isPickupBatchEditable,
  type MyGlsBookingChannel,
  MYGLS_BOOKING_CHANNEL_LABEL,
  nextPickupBatchNumber,
  PICKUP_BATCH_EXTERNAL_BLOCK_REASON,
} from "@/lib/admin/pickup-batch";
import { createReclamationShipment } from "@/lib/admin/reclamation-fulfillment.server";

type Transaction = Prisma.TransactionClient;

const TRANSACTION_OPTIONS = {
  isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  maxWait: 10_000,
  timeout: 30_000,
} as const;

export async function getPickupPostingAvailability(
  providerOverride?: string | null,
) {
  const provider = normalizeProvider(providerOverride) ??
    (await getSelectedSmallParcelProvider());
  if (provider === "MYGLS") {
    try {
      requireMyGlsEnabled();
      return {
        available: true as const,
        reason: null,
        provider: "MYGLS" as const,
        mode: "LABELS_THEN_MANUAL_BOOKING" as const,
      };
    } catch (error) {
      const cfg = getMyGlsConfig();
      return {
        available: false as const,
        reason:
          cfg.env === "production" && !cfg.enabled
            ? PICKUP_BATCH_EXTERNAL_BLOCK_REASON
            : error instanceof Error
              ? error.message
              : "MyGLS konfiguracija nije kompletna.",
        provider: "MYGLS" as const,
        mode: "LABELS_THEN_MANUAL_BOOKING" as const,
      };
    }
  }
  try {
    requireXExpressShipmentConfig(true);
    return {
      available: true as const,
      reason: null,
      provider: "X_EXPRESS" as const,
      mode: "LABELS_THEN_AUTOMATIC_BOOKING" as const,
    };
  } catch (error) {
    return {
      available: false as const,
      reason:
        error instanceof Error
          ? error.message
          : "X Express konfiguracija nije kompletna.",
      provider: "X_EXPRESS" as const,
      mode: "LABELS_THEN_AUTOMATIC_BOOKING" as const,
    };
  }
}

export async function createPickupBatch(provider: SmallParcelProvider) {
  const availability = await getPickupPostingAvailability(provider);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return await db.$transaction(async (tx) => {
        const year = new Date().getFullYear();
        const existing = await tx.pickupBatch.findMany({
          where: { number: { startsWith: `PRE-${year}-` } },
          select: { number: true },
        });
        return tx.pickupBatch.create({
          data: {
            number: nextPickupBatchNumber(
              existing.map((row) => row.number),
              year,
            ),
            courier: "COURIER_SMALL",
            provider: availability.provider,
            configurationIssue: availability.reason,
          },
        });
      }, TRANSACTION_OPTIONS);
    } catch (error) {
      if (!isRetryableCreateError(error) || attempt === 3) throw error;
    }
  }
  throw new Error("Broj naloga za preuzimanje nije mogao da se generiše.");
}

export async function savePickupPackage(
  batchId: string,
  lineId: string,
  input: Omit<PhysicalPackage, "packageNo" | "orderItemId" | "content">,
) {
  const line = await db.pickupBatchLine.findFirst({
    where: { id: lineId, batchId },
    include: {
      batch: {
        select: {
          id: true,
          status: true,
          provider: true,
          labelsCreationStartedAt: true,
          labelsCreatedAt: true,
        },
      },
    },
  });
  if (!line) throw new Error("Paket nije pronađen u ovom nalogu.");
  assertEditableBatch(line.batch);
  const provider = normalizeProvider(line.batch.provider) ??
    (await getSelectedSmallParcelProvider());
  const rawPackage = { ...input, packageNo: line.packageNo };
  const [pkg] = provider === "MYGLS"
    ? requireCompleteMyGlsPackages([rawPackage])
    : requireCompletePhysicalPackages([rawPackage]);
  const packageRoute = resolveCourierProvider({
    shippingMethod: "KURIR",
    items: [{
      withAssembly: false,
      qty: 1,
      packQty: 1,
      packWidthCm: pkg.widthCm,
      packDepthCm: pkg.depthCm,
      packHeightCm: pkg.heightCm,
      packGrossWeightKg: pkg.weightKg,
    }],
  });
  if (packageRoute.kind !== "single") {
    throw new Error("Paket nema kompletne mere za automatski izbor kurira.");
  }
  if (provider === "X_EXPRESS" && packageRoute.provider !== "X_EXPRESS") {
    throw new Error(
      "Paket preko 30 kg ili sa stranicom preko 60 cm pripada MyGLS nalogu. Ispravite mere artikla i ponovo učitajte porudžbinu.",
    );
  }
  return db.pickupBatchLine.update({
    where: { id: line.id },
    data: {
      weightKg: pkg.weightKg,
      widthCm: pkg.widthCm,
      depthCm: pkg.depthCm,
      heightCm: pkg.heightCm,
    },
  });
}

export async function loadEligibleOrders(
  batchId: string,
  actorId: string,
) {
  return db.$transaction(async (tx) => {
    await lockBatch(tx, batchId);
    const batch = await tx.pickupBatch.findUnique({
      where: { id: batchId },
      select: {
        id: true,
        status: true,
        number: true,
        provider: true,
        labelsCreationStartedAt: true,
        labelsCreatedAt: true,
      },
    });
    assertEditableBatch(batch);
    const provider = normalizeProvider(batch.provider) ??
      (await getSelectedSmallParcelProvider());

    const dc = await findDcWarehouse(tx);
    if (!dc) {
      throw new Error(
        "DC magacin nije podešen. Označite aktivni magacin kao podrazumevani DC.",
      );
    }

    const candidates = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT orders."id"
      FROM "Order" AS orders
      WHERE (
          orders."status" = 'KREIRANO'
          OR (
            orders."status" = 'U_PRIPREMI'
            AND EXISTS (
              SELECT 1
              FROM "PickupBatchLine" AS existing_lines
              WHERE existing_lines."orderId" = orders."id"
                AND existing_lines."purpose" = 'ORDER_DELIVERY'
            )
          )
        )
        AND orders."shippingMethod" = 'KURIR'
        AND NOT EXISTS (
          SELECT 1
          FROM "FiscalReceipt" AS legacy_fiscal
          WHERE legacy_fiscal."orderId" = orders."id"
        )
        AND NOT EXISTS (
          SELECT 1
          FROM "FiscalDocument" AS fiscal_documents
          WHERE fiscal_documents."orderId" = orders."id"
            AND fiscal_documents."kind" = 'SALE'
            AND fiscal_documents."status" = 'ISSUED'
        )
        AND EXISTS (
          SELECT 1
          FROM "OrderItem" AS items
          WHERE items."orderId" = orders."id"
            AND items."warehouseReservedQty" > 0
        )
        AND NOT EXISTS (
          SELECT 1
          FROM "OrderItem" AS mixed_items
          WHERE mixed_items."orderId" = orders."id"
            AND (
              mixed_items."supplierReservedQty" > 0
              OR mixed_items."withAssembly" = true
              OR mixed_items."warehouseReservedQty" < mixed_items."qty"
              OR (
                mixed_items."warehouseId" IS NOT NULL
                AND mixed_items."warehouseId" <> ${dc.id}
              )
              OR (
                mixed_items."warehouseId" IS NULL
                AND mixed_items."warehouseReservedQty" <= 0
              )
            )
        )
        AND NOT EXISTS (
          SELECT 1
          FROM "PickupBatchLine" AS pickup_lines
          WHERE pickup_lines."orderId" = orders."id"
            AND pickup_lines."purpose" = 'ORDER_DELIVERY'
        )
      ORDER BY orders."number" ASC
      FOR UPDATE OF orders SKIP LOCKED
    `);
    const orderIds = candidates.map((row) => row.id);
    if (!orderIds.length) {
      return {
        orderCount: 0,
        lineCount: 0,
        candidateCount: 0,
        skippedOtherProviderCount: 0,
        skippedInvalidDimensionsCount: 0,
        loadedMyGlsHardLimitCount: 0,
        loadedMyGlsOversizeSurchargeCount: 0,
      };
    }

    const items = await tx.orderItem.findMany({
      where: {
        orderId: { in: orderIds },
      },
      select: {
        id: true,
        orderId: true,
        sku: true,
        name: true,
        qty: true,
        withAssembly: true,
        product: {
          select: {
            packQty: true,
            packWidthCm: true,
            packDepthCm: true,
            packHeightCm: true,
            packGrossWeightKg: true,
            unitPackWidthCm: true,
            unitPackDepthCm: true,
            unitPackHeightCm: true,
            widthCm: true,
            depthCm: true,
            heightCm: true,
            grossWeightKg: true,
            weightKg: true,
          },
        },
      },
      orderBy: [{ orderId: "asc" }, { sku: "asc" }, { id: "asc" }],
    });
    let skippedOtherProviderCount = 0;
    let skippedInvalidDimensionsCount = 0;
    let loadedMyGlsHardLimitCount = 0;
    let loadedMyGlsOversizeSurchargeCount = 0;
    const packages: Array<
      PhysicalPackage & {
        orderId: string;
        lineGroupKey: string;
        quantity: number;
      }
    > = [];
    const loadedOrderIds: string[] = [];
    for (const orderId of orderIds) {
      const orderItems = items.filter((item) => item.orderId === orderId);
      const orderPackages = derivePhysicalPackages(orderItems);
      const routing = resolveCourierProvider({
        shippingMethod: "KURIR",
        items: orderPackages.map((pkg) => ({
          withAssembly: false,
          qty: 1,
          packQty: 1,
          packWidthCm: pkg.widthCm,
          packDepthCm: pkg.depthCm,
          packHeightCm: pkg.heightCm,
          packGrossWeightKg: pkg.weightKg,
        })),
      });
      if (routing.kind === "invalid_dimensions") {
        skippedInvalidDimensionsCount += 1;
        continue;
      }
      if (routing.provider !== provider) {
        skippedOtherProviderCount += 1;
        continue;
      }
      if (
        provider === "MYGLS" &&
        orderPackages.some((pkg) => hasKnownMyGlsHardLimitViolation(pkg))
      ) {
        loadedMyGlsHardLimitCount += 1;
      }
      if (
        provider === "MYGLS" &&
        orderPackages.some((pkg) => hasKnownMyGlsOversizeSurcharge(pkg))
      ) {
        loadedMyGlsOversizeSurchargeCount += 1;
      }
      loadedOrderIds.push(orderId);
      const quantityByItem = new Map(
        orderItems.map((item) => [item.id, item.qty]),
      );
      packages.push(
        ...orderPackages.map((pkg) => ({
          ...pkg,
          orderId,
          lineGroupKey: `order:${orderId}:${provider}`,
          quantity: quantityByItem.get(pkg.orderItemId ?? "") ?? 1,
        })),
      );
    }
    if (!loadedOrderIds.length) {
      return {
        orderCount: 0,
        lineCount: 0,
        candidateCount: orderIds.length,
        skippedOtherProviderCount,
        skippedInvalidDimensionsCount,
        loadedMyGlsHardLimitCount,
        loadedMyGlsOversizeSurchargeCount,
      };
    }
    await tx.pickupBatchLine.createMany({
      data: packages.map((pkg) => ({
        batchId,
        orderId: pkg.orderId,
        orderItemId: pkg.orderItemId,
        purpose: "ORDER_DELIVERY",
        lineGroupKey: pkg.lineGroupKey,
        quantity: pkg.quantity,
        packageNo: pkg.packageNo,
        weightKg: pkg.weightKg,
        widthCm: pkg.widthCm,
        depthCm: pkg.depthCm,
        heightCm: pkg.heightCm,
      })),
    });
    await tx.order.updateMany({
      where: { id: { in: loadedOrderIds }, status: "KREIRANO" },
      data: { status: "U_PRIPREMI" },
    });
    await tx.orderStatusEvent.createMany({
      data: loadedOrderIds.map((orderId) => ({
        orderId,
        status: "U_PRIPREMI" as const,
        note: `Porudžbina učitana u ${providerLabel(provider)} nalog za preuzimanje ${batch.number}.`,
        actorId,
      })),
    });
    return {
      orderCount: loadedOrderIds.length,
      lineCount: packages.length,
      candidateCount: orderIds.length,
      skippedOtherProviderCount,
      skippedInvalidDimensionsCount,
      loadedMyGlsHardLimitCount,
      loadedMyGlsOversizeSurchargeCount,
    };
  }, TRANSACTION_OPTIONS);
}

export async function queueReclamationReplacement(
  reclamationId: string,
  actorId: string,
) {
  const reclamation = await db.reclamation.findUnique({
    where: { id: reclamationId },
    select: {
      id: true,
      number: true,
      orderId: true,
      orderItemId: true,
      quantity: true,
      decision: true,
      resolution: true,
      warehouseId: true,
      warehouseStatus: true,
      orderItem: {
        select: {
          id: true,
          name: true,
          qty: true,
          withAssembly: true,
          product: {
            select: {
              packQty: true,
              packWidthCm: true,
              packDepthCm: true,
              packHeightCm: true,
              packGrossWeightKg: true,
              unitPackWidthCm: true,
              unitPackDepthCm: true,
              unitPackHeightCm: true,
              widthCm: true,
              depthCm: true,
              heightCm: true,
              grossWeightKg: true,
              weightKg: true,
            },
          },
        },
      },
      shipments: {
        where: {
          purpose: "RECLAMATION_REPLACEMENT",
          status: { not: "FAILED" },
        },
        select: { id: true },
        take: 1,
      },
      pickupBatchLines: {
        where: { purpose: "RECLAMATION_REPLACEMENT" },
        select: { batchId: true },
        take: 1,
      },
    },
  });
  if (!reclamation) throw new Error("Reklamacija nije pronađena.");
  if (
    reclamation.decision !== "PRIHVACENA" ||
    !["ZAMENA_ARTIKLA", "ZAMENA_DELA"].includes(reclamation.resolution ?? "") ||
    !reclamation.warehouseId
  ) {
    return { queued: false as const, reason: "Čeka prihvaćenu odluku, zamenu i izabrani magacin." };
  }
  if (reclamation.shipments.length) {
    return { queued: false as const, reason: "Kurirski nalog za zamenu već postoji." };
  }
  if (reclamation.pickupBatchLines[0]) {
    return {
      queued: true as const,
      alreadyQueued: true as const,
      batchId: reclamation.pickupBatchLines[0].batchId,
      provider: null,
    };
  }
  if (!reclamation.orderItem) {
    return { queued: false as const, reason: "Reklamacija nema vezanu stavku porudžbine." };
  }

  const sourceItem = {
    id: reclamation.orderItem.id,
    name: reclamation.orderItem.name,
    qty: reclamation.quantity,
    withAssembly: reclamation.orderItem.withAssembly,
    product: reclamation.orderItem.product,
  };
  const routing = resolveCourierProvider({
    shippingMethod: "KURIR",
    items: [courierRouteItem(sourceItem)],
  });
  if (routing.kind !== "single") {
    return {
      queued: false as const,
      reason: "Zamena nema kompletne dimenzije paketa za automatski izbor kurira.",
    };
  }
  const provider = routing.provider;
  const packages = derivePhysicalPackages([sourceItem]);
  if (
    provider === "MYGLS" &&
    packages.some((pkg) => hasKnownMyGlsHardLimitViolation(pkg))
  ) {
    return {
      queued: false as const,
      reason: "Paket zamene prelazi MyGLS ograničenja i zahteva ručnu obradu.",
    };
  }

  const existingDraftBatch = await db.pickupBatch.findFirst({
    where: {
      provider,
      status: "DRAFT",
      labelsCreationStartedAt: null,
      labelsCreatedAt: null,
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, number: true },
  });
  const batch = existingDraftBatch ?? (await createPickupBatch(provider));
  const lineGroupKey = `reclamation:${reclamation.id}`;
  const result = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`reclamation-picking:${reclamation.id}`}))::text AS "lock"`;
    await lockBatch(tx, batch.id);
    const existing = await tx.pickupBatchLine.findFirst({
      where: { reclamationId: reclamation.id, purpose: "RECLAMATION_REPLACEMENT" },
      select: { batchId: true },
    });
    if (existing) return { batchId: existing.batchId, lineCount: 0 };
    await tx.pickupBatchLine.createMany({
      data: packages.map((pkg) => ({
        batchId: batch.id,
        orderId: reclamation.orderId,
        orderItemId: pkg.orderItemId,
        reclamationId: reclamation.id,
        purpose: "RECLAMATION_REPLACEMENT",
        lineGroupKey,
        quantity: reclamation.quantity,
        packageNo: pkg.packageNo,
        weightKg: pkg.weightKg,
        widthCm: pkg.widthCm,
        depthCm: pkg.depthCm,
        heightCm: pkg.heightCm,
      })),
    });
    await tx.reclamation.update({
      where: { id: reclamation.id },
      data: {
        warehouseStatus:
          reclamation.warehouseStatus === "READY"
            ? "READY"
            : "REQUESTED",
        warehouseRequestedAt: new Date(),
      },
    });
    await tx.reclamationStatusEvent.create({
      data: {
        reclamationId: reclamation.id,
        status: "U_OBRADI",
        actorId,
        note: `Zamena je dodata u ${providerLabel(provider)} picking nalog ${batch.number}.`,
      },
    });
    await tx.reclamation.updateMany({
      where: { id: reclamation.id, status: "PRIMLJENO" },
      data: { status: "U_OBRADI" },
    });
    return { batchId: batch.id, lineCount: packages.length };
  }, TRANSACTION_OPTIONS);
  return {
    queued: true as const,
    alreadyQueued: result.lineCount === 0,
    batchId: result.batchId,
    provider,
  };
}

export async function removeOrderFromPickupBatch(
  batchId: string,
  orderId: string,
  actorId: string,
) {
  return db.$transaction(async (tx) => {
    await lockBatch(tx, batchId);
    await lockOrders(tx, [orderId]);
    const batch = await tx.pickupBatch.findUnique({
      where: { id: batchId },
      select: {
        id: true,
        status: true,
        number: true,
        labelsCreationStartedAt: true,
        labelsCreatedAt: true,
      },
    });
    assertEditableBatch(batch);
    const removed = await tx.pickupBatchLine.deleteMany({
      where: { batchId, orderId, purpose: "ORDER_DELIVERY" },
    });
    if (!removed.count) {
      throw new Error("Porudžbina nije pronađena u ovom nalogu.");
    }
    await restoreOrderIfNoLongerLoaded(tx, orderId, actorId, batch.number);
    return { removedLineCount: removed.count };
  }, TRANSACTION_OPTIONS);
}

export async function removePickupGroupFromBatch(
  batchId: string,
  lineGroupKey: string,
  actorId: string,
) {
  return db.$transaction(async (tx) => {
    await lockBatch(tx, batchId);
    const batch = await tx.pickupBatch.findUnique({
      where: { id: batchId },
      select: {
        id: true,
        status: true,
        number: true,
        labelsCreationStartedAt: true,
        labelsCreatedAt: true,
      },
    });
    assertEditableBatch(batch);
    const lines = await tx.pickupBatchLine.findMany({
      where: { batchId, lineGroupKey },
      select: { id: true, orderId: true, purpose: true, reclamationId: true },
    });
    if (!lines.length) throw new Error("Picking grupa nije pronađena u ovom nalogu.");
    await lockOrders(tx, Array.from(new Set(lines.map((line) => line.orderId))));
    const removed = await tx.pickupBatchLine.deleteMany({
      where: { batchId, lineGroupKey },
    });
    const orderIds = Array.from(
      new Set(
        lines
          .filter((line) => line.purpose === "ORDER_DELIVERY")
          .map((line) => line.orderId),
      ),
    );
    for (const orderId of orderIds) {
      await restoreOrderIfNoLongerLoaded(tx, orderId, actorId, batch.number);
    }
    return { removedLineCount: removed.count };
  }, TRANSACTION_OPTIONS);
}

export async function deletePickupBatches(
  batchIds: string[],
  actorId: string,
) {
  if (!batchIds.length) throw new Error("Izaberite bar jedan nalog.");
  return db.$transaction(async (tx) => {
    const uniqueIds = Array.from(new Set(batchIds)).sort();
    for (const batchId of uniqueIds) await lockBatch(tx, batchId);
    const batches = await tx.pickupBatch.findMany({
      where: { id: { in: uniqueIds } },
      include: {
        lines: { select: { orderId: true, purpose: true } },
      },
    });
    if (batches.length !== uniqueIds.length) {
      throw new Error("Jedan od izabranih naloga više ne postoji.");
    }
    for (const batch of batches) assertEditableBatch(batch);
    const orderIds = Array.from(
      new Set(
        batches.flatMap((batch) =>
          batch.lines
            .filter((line) => line.purpose === "ORDER_DELIVERY")
            .map((line) => line.orderId),
        ),
      ),
    ).sort();
    await lockOrders(tx, orderIds);
    const deleted = await tx.pickupBatch.deleteMany({
      where: { id: { in: uniqueIds } },
    });
    for (const orderId of orderIds) {
      await restoreOrderIfNoLongerLoaded(
        tx,
        orderId,
        actorId,
        batches.find((batch) =>
          batch.lines.some(
            (line) =>
              line.orderId === orderId && line.purpose === "ORDER_DELIVERY",
          ),
        )?.number ?? "obrisan nalog",
      );
    }
    return { deletedCount: deleted.count };
  }, TRANSACTION_OPTIONS);
}

export async function postPickupBatches(batchIds: string[], actorId: string) {
  if (!batchIds.length) throw new Error("Izaberite bar jedan nalog.");

  const uniqueIds = Array.from(new Set(batchIds));
  let posted = 0;
  let shipmentCount = 0;
  let labelsPrepared = 0;
  let announced = 0;
  for (const batchId of uniqueIds) {
    const result = await postPickupBatch(batchId, actorId);
    posted += 1;
    shipmentCount += result.shipmentCount;
    if (result.phase === "LABELS_PREPARED") labelsPrepared += 1;
    if (result.phase === "ANNOUNCED") announced += 1;
  }
  return { posted, shipmentCount, labelsPrepared, announced };
}

export async function recreateMyGlsLabelsForPickupBatch(
  batchId: string,
  actorId: string,
) {
  const claimed = await db.pickupBatch.updateMany({
    where: {
      id: batchId,
      provider: MYGLS_PROVIDER,
      status: "DRAFT",
      labelsCreatedAt: { not: null },
      externalBookedAt: null,
    },
    data: { status: "POSTING", configurationIssue: null },
  });
  if (!claimed.count) {
    throw new Error(
      "MyGLS adresnice mogu ponovo da se kreiraju samo za novi nalog koji još nije najavljen kuriru.",
    );
  }

  try {
    const batch = await db.pickupBatch.findUnique({
      where: { id: batchId },
      select: {
        provider: true,
        status: true,
        labelsCreatedAt: true,
        externalBookedAt: true,
        lines: {
          select: {
            lineGroupKey: true,
            orderId: true,
            orderItemId: true,
            reclamationId: true,
            purpose: true,
          },
        },
      },
    });
    if (
      !batch ||
      batch.status !== "POSTING" ||
      normalizeProvider(batch.provider) !== "MYGLS" ||
      !batch.labelsCreatedAt ||
      batch.externalBookedAt
    ) {
      throw new Error("MyGLS nalog nije dostupan za ponovno kreiranje adresnica.");
    }

    const workGroups = pickupWorkGroups(batch.lines);
    if (!workGroups.length) {
      throw new Error("Nalog nema nijednu MyGLS picking grupu.");
    }
    const orderIds = ordinaryOrderIdsForGroups(workGroups);
    const shipments = await db.shipment.findMany({
      where: {
        provider: MYGLS_PROVIDER,
        OR: [
          ...(orderIds.length
            ? [{ orderId: { in: orderIds }, purpose: "ORDER_DELIVERY" as const }]
            : []),
          ...workGroups
            .filter((group) => group.purpose === "RECLAMATION_REPLACEMENT")
            .map((group) => ({
              reclamationId: requiredReclamationId(group),
              purpose: "RECLAMATION_REPLACEMENT" as const,
            })),
        ],
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        orderId: true,
        reclamationId: true,
        purpose: true,
        rawCreateResponse: true,
      },
    });
    const shipmentIds = new Set<string>();
    for (const group of workGroups) {
      const shipment = shipments.find((candidate) =>
        group.purpose === "RECLAMATION_REPLACEMENT"
          ? candidate.purpose === "RECLAMATION_REPLACEMENT" &&
            candidate.reclamationId === group.reclamationId
          : candidate.purpose === "ORDER_DELIVERY" &&
            candidate.orderId === group.orderId &&
            samePickupAssignment(candidate.rawCreateResponse, group),
      );
      if (!shipment) {
        throw new Error(
          `Picking grupa ${group.lineGroupKey} nema postojeću MyGLS adresnicu za zamenu.`,
        );
      }
      shipmentIds.add(shipment.id);
    }

    for (const shipmentId of shipmentIds) {
      await deleteMyGlsLabelsForShipment(shipmentId);
    }

    const reset = await db.pickupBatch.updateMany({
      where: {
        id: batchId,
        status: "POSTING",
        externalBookedAt: null,
      },
      data: {
        status: "DRAFT",
        labelsCreationStartedAt: null,
        labelsCreatedAt: null,
        labelsCreatedById: null,
        configurationIssue: null,
      },
    });
    if (!reset.count) {
      throw new Error("Status naloga promenjen je tokom zamene MyGLS adresnica.");
    }
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Ponovno kreiranje MyGLS adresnica nije uspelo.";
    await db.pickupBatch.updateMany({
      where: { id: batchId, status: "POSTING" },
      data: { status: "DRAFT", configurationIssue: message },
    });
    throw error;
  }

  return createMyGlsLabelsForPickupBatch(batchId, actorId);
}

async function postPickupBatch(batchId: string, actorId: string) {
  const summary = await db.pickupBatch.findUnique({
    where: { id: batchId },
    select: {
      provider: true,
      labelsCreatedAt: true,
    },
  });
  if (!summary) throw new Error("Nalog za preuzimanje ne postoji.");
  const availability = await getPickupPostingAvailability(summary.provider);
  if (!availability.available) throw new Error(availability.reason);
  if (!summary.provider) {
    await db.pickupBatch.update({
      where: { id: batchId },
      data: { provider: availability.provider },
    });
  }
  if (availability.provider === "MYGLS") {
    const result = await createMyGlsLabelsForPickupBatch(batchId, actorId);
    return { ...result, phase: "LABELS_PREPARED" as const };
  }
  if (!summary.labelsCreatedAt) {
    const result = await createXExpressLabelsForPickupBatch(batchId, actorId);
    return { ...result, phase: "LABELS_PREPARED" as const };
  }

  const stalePosting = new Date(Date.now() - 30 * 60_000);
  await db.pickupBatch.updateMany({
    where: { id: batchId, status: "POSTING", updatedAt: { lt: stalePosting } },
    data: {
      status: "DRAFT",
      configurationIssue:
        "Prethodno slanje je prekinuto. Bezbedan idempotentni pokušaj je ponovljen.",
    },
  });
  const claimed = await db.pickupBatch.updateMany({
    where: { id: batchId, status: "DRAFT" },
    data: { status: "POSTING", configurationIssue: null },
  });
  if (!claimed.count) {
    throw new Error(
      "Nalog nije nov ili ga drugi administrator trenutno šalje kurirskoj službi.",
    );
  }

  try {
    const batch = await db.pickupBatch.findUnique({
      where: { id: batchId },
      include: {
        lines: {
          include: { orderItem: { select: { name: true } } },
          orderBy: [{ orderId: "asc" }, { packageNo: "asc" }],
        },
      },
    });
    if (!batch || batch.status !== "POSTING") {
      throw new Error("Nalog za preuzimanje nije dostupan za knjiženje.");
    }
    const workGroups = pickupWorkGroups(batch.lines);
    if (!workGroups.length) {
      throw new Error("Nalog nema nijednu picking grupu za preuzimanje.");
    }

    const orderIds = ordinaryOrderIdsForGroups(workGroups);
    const reclamationIds = workGroups
      .filter((group) => group.purpose === "RECLAMATION_REPLACEMENT")
      .map(requiredReclamationId);
    const preparedShipments = await db.shipment.findMany({
      where: {
        provider: X_EXPRESS_PROVIDER,
        status: { not: "FAILED" },
        OR: [
          ...(orderIds.length
            ? [{ orderId: { in: orderIds }, purpose: "ORDER_DELIVERY" as const }]
            : []),
          ...(reclamationIds.length
            ? [
                {
                  reclamationId: { in: reclamationIds },
                  purpose: "RECLAMATION_REPLACEMENT" as const,
                },
              ]
            : []),
        ],
      },
      orderBy: { createdAt: "desc" },
    });

    const shipmentIds: string[] = [];
    for (const group of workGroups) {
      const packageLines = group.lines;
      const packages = requireCompleteXExpressPackages(
        packageLines.map((line) => ({
          packageNo: line.packageNo,
          orderItemId: line.orderItemId,
          content: line.orderItem?.name,
          weightKg: Number(line.weightKg ?? 0),
          widthCm: Number(line.widthCm ?? 0),
          depthCm: Number(line.depthCm ?? 0),
          heightCm: Number(line.heightCm ?? 0),
        })),
      );
      const prepared = preparedShipments.find((shipment) =>
        group.purpose === "RECLAMATION_REPLACEMENT"
          ? shipment.purpose === "RECLAMATION_REPLACEMENT" &&
            shipment.reclamationId === group.reclamationId
          : shipment.purpose === "ORDER_DELIVERY" &&
            shipment.orderId === group.orderId &&
            samePickupAssignment(shipment.rawCreateResponse, group),
      );
      if (!prepared || prepared.packageCount !== packages.length) {
        throw new Error(
          `Picking grupa ${group.lineGroupKey} nema kompletnu pripremljenu X Express adresnicu.`,
        );
      }
      const shipment = await announceXExpressShipment(prepared.id);
      if (!shipment.providerShipmentId || shipment.status === "FAILED") {
        throw new Error(
          `Picking grupa ${group.lineGroupKey} nije uspešno poslata X Express-u.`,
        );
      }
      shipmentIds.push(shipment.id);
    }

    await db.$transaction(async (tx) => {
      await lockBatch(tx, batch.id);
      const completed = await tx.pickupBatch.updateMany({
        where: { id: batch.id, status: "POSTING" },
        data: {
          status: "BOOKED",
          manifestRef: `XEXPRESS:${batch.number}`,
          configurationIssue: null,
        },
      });
      if (!completed.count) {
        throw new Error("Status naloga promenjen je tokom knjiženja.");
      }
      const ordinaryOrderIds = ordinaryOrderIdsForGroups(workGroups);
      await tx.orderStatusEvent.createMany({
        data: ordinaryOrderIds.map((orderId) => ({
          orderId,
          status: "U_PRIPREMI" as const,
          note: `Nalog za preuzimanje ${batch.number} proknjižen i poslat X Express-u.`,
          actorId,
        })),
      });
    }, TRANSACTION_OPTIONS);
    return {
      shipmentCount: shipmentIds.length,
      shipmentIds,
      phase: "ANNOUNCED" as const,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Slanje X Express-u nije uspelo.";
    await db.pickupBatch.updateMany({
      where: { id: batchId, status: "POSTING" },
      data: { status: "DRAFT", configurationIssue: message },
    });
    throw error;
  }
}

async function createXExpressLabelsForPickupBatch(
  batchId: string,
  actorId: string,
) {
  let preparedCount = 0;
  const existing = await db.pickupBatch.findUnique({
    where: { id: batchId },
    select: {
      labelsCreatedAt: true,
      lines: { select: { lineGroupKey: true } },
    },
  });
  if (existing?.labelsCreatedAt) {
    return {
      shipmentCount: new Set(existing.lines.map((line) => line.lineGroupKey)).size,
      shipmentIds: [] as string[],
    };
  }

  const claimed = await db.pickupBatch.updateMany({
    where: { id: batchId, status: "DRAFT", labelsCreatedAt: null },
    data: { status: "POSTING", configurationIssue: null },
  });
  if (!claimed.count) {
    throw new Error(
      "Nalog nije nov ili drugi administrator trenutno priprema X Express adresnice.",
    );
  }

  try {
    const batch = await db.pickupBatch.findUnique({
      where: { id: batchId },
      include: {
        lines: {
          include: { orderItem: { select: { name: true } } },
          orderBy: [{ orderId: "asc" }, { packageNo: "asc" }],
        },
      },
    });
    if (!batch || batch.status !== "POSTING") {
      throw new Error("Nalog nije dostupan za pripremu X Express adresnica.");
    }
    if (normalizeProvider(batch.provider) !== "X_EXPRESS") {
      throw new Error("Nalog nije namenjen X Express kuriru.");
    }
    const workGroups = pickupWorkGroups(batch.lines);
    if (!workGroups.length) {
      throw new Error("Nalog nema nijedan paket za X Express adresnicu.");
    }

    await db.pickupBatch.update({
      where: { id: batch.id },
      data: {
        labelsCreationStartedAt:
          batch.labelsCreationStartedAt ?? new Date(),
      },
    });

    const shipmentIds: string[] = [];
    for (const group of workGroups) {
      const packages = requireCompleteXExpressPackages(
        group.lines.map((line) => ({
          packageNo: line.packageNo,
          orderItemId: line.orderItemId,
          content: line.orderItem?.name,
          weightKg: Number(line.weightKg ?? 0),
          widthCm: Number(line.widthCm ?? 0),
          depthCm: Number(line.depthCm ?? 0),
          heightCm: Number(line.heightCm ?? 0),
        })),
      );
      const shipment =
        group.purpose === "RECLAMATION_REPLACEMENT"
          ? await createReclamationShipment({
              reclamationId: requiredReclamationId(group),
              purpose: "RECLAMATION_REPLACEMENT",
              packageCount: packages.length,
              packages,
              provider: "X_EXPRESS",
              fromPickupBatch: true,
              actorId,
            })
          : await createShipmentForOrder(group.orderId, {
              packageCount: packages.length,
              packages,
              provider: "X_EXPRESS",
              orderItemIds: orderItemIdsForGroup(group),
              codAmount: await pickupAssignmentCodAmount(
                group.orderId,
                "X_EXPRESS",
                orderItemIdsForGroup(group),
              ),
            });
      if (
        shipment.provider !== X_EXPRESS_PROVIDER ||
        shipment.status === "FAILED" ||
        !shipment.trackingNo ||
        !Array.isArray(shipment.providerParcelNumbers) ||
        shipment.providerParcelNumbers.length !== packages.length
      ) {
        throw new Error(
          `Picking grupa ${group.lineGroupKey} nema kompletnu X Express adresnicu.`,
        );
      }
      preparedCount += 1;
      shipmentIds.push(shipment.id);
    }

    await db.$transaction(async (tx) => {
      await lockBatch(tx, batch.id);
      const completed = await tx.pickupBatch.updateMany({
        where: { id: batch.id, status: "POSTING" },
        data: {
          status: "DRAFT",
          labelsCreatedAt: new Date(),
          labelsCreatedById: actorId,
          configurationIssue: null,
        },
      });
      if (!completed.count) {
        throw new Error("Status naloga promenjen je tokom pripreme adresnica.");
      }
      await tx.orderStatusEvent.createMany({
        data: ordinaryOrderIdsForGroups(workGroups).map((orderId) => ({
          orderId,
          status: "U_PRIPREMI" as const,
          note: `X Express adresnice su pripremljene za nalog ${batch.number}; pošiljke još nisu poslate kuriru.`,
          actorId,
        })),
      });
    }, TRANSACTION_OPTIONS);
    return { shipmentCount: shipmentIds.length, shipmentIds };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "X Express adresnice nisu pripremljene.";
    await db.pickupBatch.updateMany({
      where: { id: batchId, status: "POSTING" },
      data: {
        status: "DRAFT",
        configurationIssue: message,
        ...(preparedCount === 0 ? { labelsCreationStartedAt: null } : {}),
      },
    });
    throw error;
  }
}

async function createMyGlsLabelsForPickupBatch(
  batchId: string,
  actorId: string,
) {
  let providerAttempted = false;
  const existing = await db.pickupBatch.findUnique({
    where: { id: batchId },
    select: {
      labelsCreationStartedAt: true,
      labelsCreatedAt: true,
      lines: { select: { lineGroupKey: true } },
    },
  });
  if (existing?.labelsCreatedAt) {
    return {
      shipmentCount: new Set(existing.lines.map((line) => line.lineGroupKey)).size,
      shipmentIds: [] as string[],
    };
  }

  const claimed = await db.pickupBatch.updateMany({
    where: { id: batchId, status: "DRAFT" },
    data: {
      status: "POSTING",
      configurationIssue: null,
    },
  });
  if (!claimed.count) {
    throw new Error(
      "Nalog nije nov ili drugi administrator trenutno kreira MyGLS adresnice.",
    );
  }

  try {
    const batch = await db.pickupBatch.findUnique({
      where: { id: batchId },
      include: {
        lines: {
          include: {
            orderItem: { select: { name: true } },
          },
          orderBy: [{ orderId: "asc" }, { packageNo: "asc" }],
        },
      },
    });
    if (!batch || batch.status !== "POSTING") {
      throw new Error("Nalog nije dostupan za kreiranje MyGLS adresnica.");
    }
    if (normalizeProvider(batch.provider) !== "MYGLS") {
      throw new Error("Nalog nije namenjen MyGLS kuriru.");
    }
    const workGroups = pickupWorkGroups(batch.lines);
    if (!workGroups.length) {
      throw new Error("Nalog nema nijedan paket za MyGLS adresnicu.");
    }

    await db.pickupBatch.update({
      where: { id: batch.id },
      data: {
        labelsCreationStartedAt:
          batch.labelsCreationStartedAt ?? new Date(),
      },
    });

    const shipmentIds: string[] = [];
    for (const group of workGroups) {
      const packageLines = group.lines;
      const packages = requireCompleteMyGlsPackages(
        packageLines.map((line) => ({
          packageNo: line.packageNo,
          orderItemId: line.orderItemId,
          content: line.orderItem?.name,
          weightKg: Number(line.weightKg ?? 0),
          widthCm: Number(line.widthCm ?? 0),
          depthCm: Number(line.depthCm ?? 0),
          heightCm: Number(line.heightCm ?? 0),
        })),
      );
      providerAttempted = true;
      const shipment = group.purpose === "RECLAMATION_REPLACEMENT"
        ? await createReclamationShipment({
            reclamationId: requiredReclamationId(group),
            purpose: "RECLAMATION_REPLACEMENT",
            packages,
            packageCount: packages.length,
            provider: "MYGLS",
            fromPickupBatch: true,
            actorId,
          })
        : await createShipmentForOrder(group.orderId, {
            packages,
            packageCount: packages.length,
            provider: "MYGLS",
            orderItemIds: orderItemIdsForGroup(group),
            codAmount: await pickupAssignmentCodAmount(
              group.orderId,
              "MYGLS",
              orderItemIdsForGroup(group),
            ),
          });
      if (shipment.provider !== MYGLS_PROVIDER || shipment.status === "FAILED") {
        throw new Error(
          `Picking grupa ${group.lineGroupKey} nema uspešno kreiranu MyGLS adresnicu.`,
        );
      }
      shipmentIds.push(shipment.id);
    }

    await db.$transaction(async (tx) => {
      await lockBatch(tx, batch.id);
      const completed = await tx.pickupBatch.updateMany({
        where: { id: batch.id, status: "POSTING" },
        data: {
          status: "DRAFT",
          labelsCreatedAt: new Date(),
          labelsCreatedById: actorId,
          configurationIssue: null,
        },
      });
      if (!completed.count) {
        throw new Error("Status naloga promenjen je tokom kreiranja adresnica.");
      }
      const ordinaryOrderIds = ordinaryOrderIdsForGroups(workGroups);
      await tx.orderStatusEvent.createMany({
        data: ordinaryOrderIds.map((orderId) => ({
          orderId,
          status: "U_PRIPREMI" as const,
          note: `MyGLS adresnica je kreirana za nalog ${batch.number}; prikup još nije najavljen.`,
          actorId,
        })),
      });
    }, TRANSACTION_OPTIONS);
    return { shipmentCount: shipmentIds.length, shipmentIds };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "MyGLS adresnice nisu kreirane.";
    await db.pickupBatch.updateMany({
      where: { id: batchId, status: "POSTING" },
      data: {
        status: "DRAFT",
        configurationIssue: message,
        ...(!providerAttempted ? { labelsCreationStartedAt: null } : {}),
      },
    });
    throw error;
  }
}

export async function confirmMyGlsPickupAnnouncement(
  batchId: string,
  actorId: string,
  input: {
    channel: MyGlsBookingChannel;
    reference: string;
  },
) {
  if (!input.reference.trim()) {
    throw new Error("Referenca GLS najave je obavezna.");
  }
  return db.$transaction(async (tx) => {
    await lockBatch(tx, batchId);
    const batch = await tx.pickupBatch.findUnique({
      where: { id: batchId },
      include: {
        lines: {
          select: {
            orderId: true,
            lineGroupKey: true,
            purpose: true,
            reclamationId: true,
            orderItemId: true,
          },
        },
      },
    });
    if (!batch) throw new Error("Nalog za preuzimanje ne postoji.");
    if (normalizeProvider(batch.provider) !== "MYGLS") {
      throw new Error("Ručna potvrda najave dozvoljena je samo za MyGLS nalog.");
    }
    if (batch.status !== "DRAFT") {
      throw new Error("Samo novi MyGLS nalog može biti potvrđen kao najavljen.");
    }
    if (!batch.labelsCreatedAt) {
      throw new Error("Prvo moraju biti kreirane MyGLS adresnice za sve pakete.");
    }
    const workGroups = pickupWorkGroups(batch.lines);
    if (!workGroups.length) throw new Error("Nalog nema pakete za preuzimanje.");
    const orderIds = ordinaryOrderIdsForGroups(workGroups);

    const shipments = await tx.shipment.findMany({
      where: {
        provider: MYGLS_PROVIDER,
        AND: [
          usableMyGlsLabelWhere(),
          {
            OR: [
              ...(orderIds.length
                ? [{ orderId: { in: orderIds }, purpose: "ORDER_DELIVERY" as const }]
                : []),
              ...workGroups
                .filter((group) => group.purpose === "RECLAMATION_REPLACEMENT")
                .map((group) => ({
                  reclamationId: requiredReclamationId(group),
                  purpose: "RECLAMATION_REPLACEMENT" as const,
                })),
            ],
          },
        ],
      },
      select: {
        orderId: true,
        reclamationId: true,
        purpose: true,
        rawCreateResponse: true,
      },
    });
    const missing = workGroups.filter((group) =>
      group.purpose === "RECLAMATION_REPLACEMENT"
        ? !shipments.some(
            (shipment) =>
              shipment.purpose === "RECLAMATION_REPLACEMENT" &&
              shipment.reclamationId === group.reclamationId,
          )
        : !shipments.some(
            (shipment) =>
              shipment.purpose === "ORDER_DELIVERY" &&
              shipment.orderId === group.orderId &&
              samePickupAssignment(shipment.rawCreateResponse, group),
          ),
    );
    if (missing.length) {
      throw new Error(
        `Nedostaje uspešna MyGLS adresnica za ${missing.length} picking grupa.`,
      );
    }

    const reference = input.reference.trim().slice(0, 120);
    const bookedAt = new Date();
    await tx.pickupBatch.update({
      where: { id: batch.id },
      data: {
        status: "BOOKED",
        manifestRef: `MYGLS:${input.channel}:${reference}`,
        externalBookedAt: bookedAt,
        externalBookingChannel: input.channel,
        externalBookingReference: reference,
        externalBookedById: actorId,
        configurationIssue: null,
      },
    });
    await tx.orderStatusEvent.createMany({
      data: orderIds.map((orderId) => ({
        orderId,
        status: "U_PRIPREMI" as const,
        note: `MyGLS prikup ${batch.number} ručno potvrđen preko ${MYGLS_BOOKING_CHANNEL_LABEL[input.channel]} (ref. ${reference}).`,
        actorId,
      })),
    });
    return { orderCount: workGroups.length, bookedAt };
  }, TRANSACTION_OPTIONS);
}

async function findDcWarehouse(tx: Transaction) {
  const defaultDc = await tx.warehouse.findFirst({
    where: { active: true, isDefault: true },
    orderBy: { createdAt: "asc" },
    select: { id: true, code: true, name: true },
  });
  if (defaultDc) return defaultDc;
  return tx.warehouse.findFirst({
    where: { active: true, code: { equals: "DC", mode: "insensitive" } },
    orderBy: { createdAt: "asc" },
    select: { id: true, code: true, name: true },
  });
}

async function restoreOrderIfNoLongerLoaded(
  tx: Transaction,
  orderId: string,
  actorId: string,
  batchNumber: string,
) {
  const remaining = await tx.pickupBatchLine.count({
    where: { orderId, purpose: "ORDER_DELIVERY" },
  });
  if (remaining) return false;
  const updated = await tx.order.updateMany({
    where: { id: orderId, status: "U_PRIPREMI" },
    data: { status: "KREIRANO" },
  });
  if (!updated.count) return false;
  await tx.orderStatusEvent.create({
    data: {
      orderId,
      status: "KREIRANO",
      note: `Porudžbina uklonjena iz naloga za preuzimanje ${batchNumber}.`,
      actorId,
    },
  });
  return true;
}

async function lockBatch(tx: Transaction, batchId: string) {
  await tx.$queryRaw(Prisma.sql`
    SELECT "id"
    FROM "PickupBatch"
    WHERE "id" = ${batchId}
    FOR UPDATE
  `);
}

async function lockOrders(tx: Transaction, orderIds: string[]) {
  if (!orderIds.length) return;
  await tx.$queryRaw(Prisma.sql`
    SELECT "id"
    FROM "Order"
    WHERE "id" IN (${Prisma.join(orderIds)})
    ORDER BY "id" ASC
    FOR UPDATE
  `);
}

function assertEditableBatch(
  batch: {
    id: string;
    status: PickupBatchStatus;
    labelsCreationStartedAt?: Date | null;
    labelsCreatedAt?: Date | null;
  } | null,
): asserts batch is {
  id: string;
  status: PickupBatchStatus;
  labelsCreationStartedAt?: Date | null;
  labelsCreatedAt?: Date | null;
} {
  if (!batch) throw new Error("Nalog za preuzimanje ne postoji.");
  if (!isPickupBatchEditable(batch.status)) {
    throw new Error("Samo novi nalog može da se menja ili obriše.");
  }
  if (batch.labelsCreationStartedAt || batch.labelsCreatedAt) {
    throw new Error(
      "Nalog je zaključan jer je kreiranje kurirskih adresnica već započeto.",
    );
  }
}

function normalizeProvider(value: string | null | undefined): SmallParcelProvider | null {
  const normalized = value?.trim().toUpperCase();
  if (normalized === "MYGLS") return "MYGLS";
  if (normalized === "X_EXPRESS" || normalized === "XPRESS") return "X_EXPRESS";
  return null;
}

type PickupWorkLine = {
  lineGroupKey: string;
  orderId: string;
  orderItemId: string | null;
  reclamationId: string | null;
  purpose: ShipmentPurpose;
};

type PickupWorkGroup<T extends PickupWorkLine = PickupWorkLine> = {
  lineGroupKey: string;
  orderId: string;
  reclamationId: string | null;
  purpose: ShipmentPurpose;
  lines: T[];
};

function pickupWorkGroups<T extends PickupWorkLine>(lines: readonly T[]) {
  const groups = new Map<string, PickupWorkGroup<T>>();
  for (const line of lines) {
    const current = groups.get(line.lineGroupKey);
    if (current) {
      if (
        current.orderId !== line.orderId ||
        current.purpose !== line.purpose ||
        current.reclamationId !== line.reclamationId
      ) {
        throw new Error(
          `Picking grupa ${line.lineGroupKey} sadrži neusaglašene redove.`,
        );
      }
      current.lines.push(line);
      continue;
    }
    groups.set(line.lineGroupKey, {
      lineGroupKey: line.lineGroupKey,
      orderId: line.orderId,
      reclamationId: line.reclamationId,
      purpose: line.purpose,
      lines: [line],
    });
  }
  return [...groups.values()];
}

function orderItemIdsForGroup(group: PickupWorkGroup) {
  return Array.from(
    new Set(
      group.lines
        .map((line) => line.orderItemId)
        .filter((id): id is string => Boolean(id)),
    ),
  );
}

function ordinaryOrderIdsForGroups(groups: readonly PickupWorkGroup[]) {
  return Array.from(
    new Set(
      groups
        .filter((group) => group.purpose === "ORDER_DELIVERY")
        .map((group) => group.orderId),
    ),
  );
}

function requiredReclamationId(group: PickupWorkGroup) {
  if (!group.reclamationId) {
    throw new Error(`Picking grupa ${group.lineGroupKey} nema reklamaciju.`);
  }
  return group.reclamationId;
}

function samePickupAssignment(raw: unknown, group: PickupWorkGroup) {
  const itemIds = orderItemIdsForGroup(group);
  if (!itemIds.length) return false;
  const assignment = readShipmentAssignment(raw);
  return assignment == null || sameShipmentAssignment(raw, itemIds);
}

function courierRouteItem(item: {
  qty: number;
  withAssembly: boolean;
  product?: {
    packQty?: number | null;
    packWidthCm?: unknown;
    packDepthCm?: unknown;
    packHeightCm?: unknown;
    unitPackWidthCm?: unknown;
    unitPackDepthCm?: unknown;
    unitPackHeightCm?: unknown;
    widthCm?: unknown;
    depthCm?: unknown;
    heightCm?: unknown;
    packGrossWeightKg?: unknown;
    grossWeightKg?: unknown;
    weightKg?: unknown;
  } | null;
}) {
  return {
    withAssembly: item.withAssembly,
    qty: item.qty,
    packQty: item.product?.packQty,
    packWidthCm: firstPositiveNumber(
      item.product?.packWidthCm,
      item.product?.unitPackWidthCm,
      item.product?.widthCm,
    ),
    packDepthCm: firstPositiveNumber(
      item.product?.packDepthCm,
      item.product?.unitPackDepthCm,
      item.product?.depthCm,
    ),
    packHeightCm: firstPositiveNumber(
      item.product?.packHeightCm,
      item.product?.unitPackHeightCm,
      item.product?.heightCm,
    ),
    packGrossWeightKg: firstPositiveNumber(
      item.product?.packGrossWeightKg,
      item.product?.grossWeightKg,
      item.product?.weightKg,
    ),
  };
}

function courierProviderForItem(
  item: Parameters<typeof courierRouteItem>[0],
): SmallParcelProvider | null {
  const routing = resolveCourierProvider({
    shippingMethod: "KURIR",
    items: [courierRouteItem(item)],
  });
  return routing.kind === "single" ? routing.provider : null;
}

function providerLabel(provider: SmallParcelProvider) {
  return provider === "MYGLS" ? "MyGLS" : "X Express";
}

async function pickupAssignmentCodAmount(
  orderId: string,
  provider: SmallParcelProvider,
  assignedOrderItemIds: readonly string[],
) {
  const order = await db.order.findUnique({
    where: { id: orderId },
    select: {
      total: true,
      items: {
        select: {
          id: true,
          qty: true,
          unitPriceSale: true,
          assemblyPrice: true,
          withAssembly: true,
          product: {
            select: {
              packQty: true,
              packWidthCm: true,
              packDepthCm: true,
              packHeightCm: true,
              unitPackWidthCm: true,
              unitPackDepthCm: true,
              unitPackHeightCm: true,
              widthCm: true,
              depthCm: true,
              heightCm: true,
              packGrossWeightKg: true,
              grossWeightKg: true,
              weightKg: true,
            },
          },
        },
      },
    },
  });
  if (!order) throw new Error("Porudžbina za obračun otkupnine ne postoji.");
  const assigned = new Set(assignedOrderItemIds);
  if (
    order.items.length > 0 &&
    order.items.every((item) => assigned.has(item.id))
  ) {
    return Number(order.total);
  }
  const weights = new Map<SmallParcelProvider, number>();
  for (const item of order.items) {
    const itemProvider = courierProviderForItem(item);
    if (!itemProvider) {
      throw new Error(
        "Otkupnina ne može da se podeli jer jedna stavka nema kompletne dimenzije.",
      );
    }
    const lineValue =
      Number(item.unitPriceSale) * item.qty +
      (item.withAssembly ? Number(item.assemblyPrice ?? 0) * item.qty : 0);
    weights.set(itemProvider, (weights.get(itemProvider) ?? 0) + lineValue);
  }
  const ordered = (["X_EXPRESS", "MYGLS"] as const)
    .filter((key) => weights.has(key))
    .map((key) => ({ key, weight: weights.get(key) ?? 0 }));
  return splitAmountByWeights(Number(order.total), ordered).get(provider) ?? 0;
}

function firstPositiveNumber(...values: unknown[]) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) return number;
  }
  return null;
}

function isRetryableCreateError(error: unknown) {
  return (
    (error instanceof Prisma.PrismaClientKnownRequestError &&
      (error.code === "P2002" || error.code === "P2034")) ||
    (error instanceof Error && /serialize|deadlock/i.test(error.message))
  );
}
