import "server-only";

import { Prisma, type PickupBatchStatus } from "@prisma/client";
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
  requireCompleteMyGlsPackages,
  type PhysicalPackage,
} from "@/lib/courier/packages";
import { resolveCourierProvider } from "@/lib/courier/routing";
import {
  getMyGlsConfig,
  MYGLS_PROVIDER,
  requireMyGlsEnabled,
  type SmallParcelProvider,
} from "@/lib/mygls/config";
import {
  requireXExpressShipmentConfig,
  X_EXPRESS_PROVIDER,
} from "@/lib/x-express/config";
import {
  isPickupBatchEditable,
  type MyGlsBookingChannel,
  MYGLS_BOOKING_CHANNEL_LABEL,
  nextPickupBatchNumber,
  PICKUP_BATCH_EXTERNAL_BLOCK_REASON,
  validateMyGlsPickupWindow,
  validateXExpressPickupWindow,
} from "@/lib/admin/pickup-batch";

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
      mode: "AUTOMATIC_BOOKING" as const,
    };
  } catch (error) {
    return {
      available: false as const,
      reason:
        error instanceof Error
          ? error.message
          : "X Express konfiguracija nije kompletna.",
      provider: "X_EXPRESS" as const,
      mode: "AUTOMATIC_BOOKING" as const,
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

export async function savePickupWindow(
  batchId: string,
  pickupDate: Date,
  pickupWindowEnd: Date,
) {
  if (!batchId) throw new Error("Nalog za preuzimanje nije izabran.");
  const batch = await db.pickupBatch.findUnique({
    where: { id: batchId },
    select: {
      id: true,
      status: true,
      provider: true,
      labelsCreationStartedAt: true,
      labelsCreatedAt: true,
    },
  });
  assertEditableBatch(batch);
  const provider = normalizeProvider(batch.provider) ??
    (await getSelectedSmallParcelProvider());
  if (provider === "MYGLS") {
    const priorMyGlsPickupCount = await db.pickupBatch.count({
      where: {
        id: { not: batchId },
        provider: MYGLS_PROVIDER,
        status: { in: ["BOOKED", "PICKED_UP"] },
        externalBookedAt: { not: null },
      },
    });
    validateMyGlsPickupWindow(pickupDate, pickupWindowEnd, new Date(), {
      requireLeadTime: priorMyGlsPickupCount === 0,
    });
  } else {
    validateXExpressPickupWindow(pickupDate, pickupWindowEnd);
  }
  return db.pickupBatch.update({
    where: { id: batchId },
    data: { pickupDate, pickupWindowEnd },
  });
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
  const largestSide = Math.max(pkg.widthCm, pkg.depthCm, pkg.heightCm);
  if (provider === "X_EXPRESS" && largestSide > 60) {
    throw new Error(
      "Paket sa stranicom preko 60 cm pripada MyGLS nalogu. Ispravite mere artikla i ponovo učitajte porudžbinu.",
    );
  }
  if (provider === "MYGLS" && largestSide <= 60) {
    throw new Error(
      "Paket do 60 cm na svakoj strani pripada X Express nalogu. Ispravite mere artikla i ponovo učitajte porudžbinu.",
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
  period: { from?: Date | null; toExclusive?: Date | null } = {},
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

    const dc = await findDcWarehouse(tx);
    if (!dc) {
      throw new Error(
        "DC magacin nije podešen. Označite aktivni magacin kao podrazumevani DC.",
      );
    }

    const candidates = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT orders."id"
      FROM "Order" AS orders
      WHERE orders."status" = 'KREIRANO'
        AND orders."shippingMethod" = 'KURIR'
        ${period.from ? Prisma.sql`AND orders."createdAt" >= ${period.from}` : Prisma.empty}
        ${period.toExclusive ? Prisma.sql`AND orders."createdAt" < ${period.toExclusive}` : Prisma.empty}
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
        )
      ORDER BY orders."number" ASC
      FOR UPDATE OF orders SKIP LOCKED
      LIMIT 2000
    `);
    const orderIds = candidates.map((row) => row.id);
    if (!orderIds.length) {
      return {
        orderCount: 0,
        lineCount: 0,
        candidateCount: 0,
        skippedOtherProviderCount: 0,
        skippedMixedCount: 0,
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
    const provider = normalizeProvider(batch.provider) ??
      (await getSelectedSmallParcelProvider());
    let skippedOtherProviderCount = 0;
    let skippedMixedCount = 0;
    let skippedInvalidDimensionsCount = 0;
    let loadedMyGlsHardLimitCount = 0;
    let loadedMyGlsOversizeSurchargeCount = 0;
    const packages: Array<PhysicalPackage & { orderId: string }> = [];
    const loadedOrderIds: string[] = [];
    for (const orderId of orderIds) {
      const orderItems = items.filter((item) => item.orderId === orderId);
      const routing = resolveCourierProvider({
        shippingMethod: "KURIR",
        items: orderItems.map((item) => ({
          withAssembly: item.withAssembly,
          qty: item.qty,
          packQty: item.product?.packQty,
          packWidthCm: numberOrNull(
            item.product?.packWidthCm ??
              item.product?.unitPackWidthCm ??
              item.product?.widthCm,
          ),
          packDepthCm: numberOrNull(
            item.product?.packDepthCm ??
              item.product?.unitPackDepthCm ??
              item.product?.depthCm,
          ),
          packHeightCm: numberOrNull(
            item.product?.packHeightCm ??
              item.product?.unitPackHeightCm ??
              item.product?.heightCm,
          ),
          packGrossWeightKg: numberOrNull(
            item.product?.packGrossWeightKg ??
              item.product?.grossWeightKg ??
              item.product?.weightKg,
          ),
        })),
      });
      if (routing.kind === "invalid_dimensions") {
        skippedInvalidDimensionsCount += 1;
        continue;
      }
      if (routing.kind === "mixed") {
        skippedMixedCount += 1;
        continue;
      }
      if (routing.provider !== provider) {
        skippedOtherProviderCount += 1;
        continue;
      }
      const orderPackages = derivePhysicalPackages(orderItems);
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
      packages.push(...orderPackages.map((pkg) => ({ ...pkg, orderId })));
    }
    if (!loadedOrderIds.length) {
      return {
        orderCount: 0,
        lineCount: 0,
        candidateCount: orderIds.length,
        skippedOtherProviderCount,
        skippedMixedCount,
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
        note: `Porudžbina učitana u nalog za preuzimanje ${batch.number}.`,
        actorId,
      })),
    });
    return {
      orderCount: loadedOrderIds.length,
      lineCount: packages.length,
      candidateCount: orderIds.length,
      skippedOtherProviderCount,
      skippedMixedCount,
      skippedInvalidDimensionsCount,
      loadedMyGlsHardLimitCount,
      loadedMyGlsOversizeSurchargeCount,
    };
  }, TRANSACTION_OPTIONS);
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
      where: { batchId, orderId },
    });
    if (!removed.count) {
      throw new Error("Porudžbina nije pronađena u ovom nalogu.");
    }
    await restoreOrderIfNoLongerLoaded(tx, orderId, actorId, batch.number);
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
        lines: { select: { orderId: true } },
      },
    });
    if (batches.length !== uniqueIds.length) {
      throw new Error("Jedan od izabranih naloga više ne postoji.");
    }
    for (const batch of batches) assertEditableBatch(batch);
    const orderIds = Array.from(
      new Set(batches.flatMap((batch) => batch.lines.map((line) => line.orderId))),
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
          batch.lines.some((line) => line.orderId === orderId),
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
  for (const batchId of uniqueIds) {
    const result = await postPickupBatch(batchId, actorId);
    posted += 1;
    shipmentCount += result.shipmentCount;
  }
  return { posted, shipmentCount };
}

async function postPickupBatch(batchId: string, actorId: string) {
  const summary = await db.pickupBatch.findUnique({
    where: { id: batchId },
    select: {
      provider: true,
      pickupDate: true,
      pickupWindowEnd: true,
    },
  });
  if (!summary) throw new Error("Nalog za preuzimanje ne postoji.");
  if (!summary.pickupDate || !summary.pickupWindowEnd) {
    throw new Error("Početak i kraj termina preuzimanja su obavezni.");
  }
  if (normalizeProvider(summary.provider) === "X_EXPRESS") {
    validateXExpressPickupWindow(summary.pickupDate, summary.pickupWindowEnd);
  }
  const availability = await getPickupPostingAvailability(summary.provider);
  if (!availability.available) throw new Error(availability.reason);
  if (!summary.provider) {
    await db.pickupBatch.update({
      where: { id: batchId },
      data: { provider: availability.provider },
    });
  }
  if (availability.provider === "MYGLS") {
    return createMyGlsLabelsForPickupBatch(batchId, actorId);
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
    if (!batch.pickupDate) {
      throw new Error("Datum preuzimanja je obavezan pre knjiženja naloga.");
    }
    const orderIds = Array.from(new Set(batch.lines.map((line) => line.orderId)));
    if (!orderIds.length) {
      throw new Error("Nalog nema nijednu porudžbinu za preuzimanje.");
    }

    const shipmentIds: string[] = [];
    for (const orderId of orderIds) {
      const packageLines = batch.lines.filter((line) => line.orderId === orderId);
      const packages = requireCompletePhysicalPackages(
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
      if (
        packages.some(
          (pkg) => Math.max(pkg.widthCm, pkg.depthCm, pkg.heightCm) > 60,
        )
      ) {
        throw new Error(
          "X Express nalog sadrži paket sa stranicom preko 60 cm; prebacite porudžbinu u MyGLS nalog.",
        );
      }
      const shipment = await createShipmentForOrder(orderId, {
        packageCount: packages.length,
        packages,
        provider: "X_EXPRESS",
      });
      if (shipment.provider !== X_EXPRESS_PROVIDER || shipment.status === "FAILED") {
        throw new Error(
          `Porudžbina ${orderId} nije uspešno najavljena X Express-u.`,
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
      await tx.orderStatusEvent.createMany({
        data: orderIds.map((orderId) => ({
          orderId,
          status: "U_PRIPREMI" as const,
          note: `Nalog za preuzimanje ${batch.number} proknjižen i poslat X Express-u.`,
          actorId,
        })),
      });
    }, TRANSACTION_OPTIONS);
    return { shipmentCount: shipmentIds.length, shipmentIds };
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
      lines: { select: { orderId: true } },
    },
  });
  if (existing?.labelsCreatedAt) {
    return {
      shipmentCount: new Set(existing.lines.map((line) => line.orderId)).size,
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
    if (!batch.pickupDate || !batch.pickupWindowEnd) {
      throw new Error("Početak i kraj termina preuzimanja su obavezni.");
    }
    const priorMyGlsPickupCount = await db.pickupBatch.count({
      where: {
        id: { not: batch.id },
        provider: MYGLS_PROVIDER,
        status: { in: ["BOOKED", "PICKED_UP"] },
        externalBookedAt: { not: null },
      },
    });
    validateMyGlsPickupWindow(batch.pickupDate, batch.pickupWindowEnd, new Date(), {
      requireLeadTime: priorMyGlsPickupCount === 0,
    });
    const orderIds = Array.from(new Set(batch.lines.map((line) => line.orderId)));
    if (!orderIds.length) {
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
    for (const orderId of orderIds) {
      const packageLines = batch.lines.filter((line) => line.orderId === orderId);
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
      const shipment = await createShipmentForOrder(orderId, {
        pickupDate: batch.pickupDate,
        packages,
        packageCount: packages.length,
        provider: "MYGLS",
      });
      if (shipment.provider !== MYGLS_PROVIDER || shipment.status === "FAILED") {
        throw new Error(
          `Porudžbina ${orderId} nema uspešno kreiranu MyGLS adresnicu.`,
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
      await tx.orderStatusEvent.createMany({
        data: orderIds.map((orderId) => ({
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
      include: { lines: { select: { orderId: true } } },
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
    if (!batch.pickupDate || !batch.pickupWindowEnd) {
      throw new Error("Termin preuzimanja nije kompletan.");
    }
    const priorMyGlsPickupCount = await tx.pickupBatch.count({
      where: {
        id: { not: batch.id },
        provider: MYGLS_PROVIDER,
        status: { in: ["BOOKED", "PICKED_UP"] },
        externalBookedAt: { not: null },
      },
    });
    validateMyGlsPickupWindow(batch.pickupDate, batch.pickupWindowEnd, new Date(), {
      requireLeadTime: priorMyGlsPickupCount === 0,
    });
    const orderIds = Array.from(new Set(batch.lines.map((line) => line.orderId)));
    if (!orderIds.length) throw new Error("Nalog nema pakete za preuzimanje.");

    const shipments = await tx.shipment.findMany({
      where: {
        orderId: { in: orderIds },
        provider: MYGLS_PROVIDER,
        purpose: "ORDER_DELIVERY",
        status: { not: "FAILED" },
      },
      select: { orderId: true },
    });
    const shipmentOrders = new Set(shipments.map((shipment) => shipment.orderId));
    const missing = orderIds.filter((orderId) => !shipmentOrders.has(orderId));
    if (missing.length) {
      throw new Error(
        `Nedostaje uspešna MyGLS adresnica za ${missing.length} porudžbina.`,
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
    return { orderCount: orderIds.length, bookedAt };
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
  const remaining = await tx.pickupBatchLine.count({ where: { orderId } });
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
      "Nalog je zaključan jer je kreiranje MyGLS adresnica već započeto.",
    );
  }
}

function normalizeProvider(value: string | null | undefined): SmallParcelProvider | null {
  const normalized = value?.trim().toUpperCase();
  if (normalized === "MYGLS") return "MYGLS";
  if (normalized === "X_EXPRESS" || normalized === "XPRESS") return "X_EXPRESS";
  return null;
}

function numberOrNull(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function isRetryableCreateError(error: unknown) {
  return (
    (error instanceof Prisma.PrismaClientKnownRequestError &&
      (error.code === "P2002" || error.code === "P2034")) ||
    (error instanceof Error && /serialize|deadlock/i.test(error.message))
  );
}
