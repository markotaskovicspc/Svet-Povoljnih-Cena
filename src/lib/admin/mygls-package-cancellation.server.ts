import "server-only";

import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { createPickupBatch } from "@/lib/admin/pickup-batch.server";
import { loadOrderForEmail, sendPartialDelivery } from "@/lib/email";
import { MyGlsClient, bytesFromMyGls } from "@/lib/mygls/client";
import { uploadMyGlsLabelPdf } from "@/lib/mygls/labels";
import { normalizeMyGlsStatusResponses } from "@/lib/mygls/status";
import {
  readMyGlsPackageAssignments,
  type MyGlsPackageAssignment,
} from "@/lib/mygls/shipments";
import {
  readShipmentAssignment,
  withShipmentAssignment,
} from "@/lib/courier/shipment-assignment";

const PICKED_STATUSES = new Set([
  "PICKED_UP",
  "IN_TRANSIT",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
  "RETURNED",
]);
const STALE_CLAIM_MS = 10 * 60_000;

export async function deferMyGlsPickupPackage(
  lineId: string,
  actorId: string,
) {
  const claimed = await claimCancellation(lineId, actorId);
  if (claimed.alreadyDeferred) return claimed.result;

  try {
    let line = await loadCancellationLine(lineId);
    if (!line.providerLabelCancelledAt) {
      await assertStillWaitingAtMyGls(line);
      line = await loadCancellationLine(lineId);
      if (line.courierPickedUpAt) {
        throw new Error("GLS je u međuvremenu preuzeo paket; otkazivanje nije dozvoljeno.");
      }
    }

    const activeLines = await db.pickupBatchLine.findMany({
      where: {
        shipmentId: line.shipmentId,
        deferredAt: null,
        providerLabelCancelledAt: null,
      },
      orderBy: [{ packageNo: "asc" }, { id: "asc" }],
    });
    const target = activeLines.find((candidate) => candidate.id === line.id) ?? line;
    const remaining = activeLines.filter((candidate) => candidate.id !== line.id);
    const assignment = readShipmentAssignment(line.shipment.rawCreateResponse);
    const currentCod = money(
      Number(line.shipment.codAmount ?? assignment?.codAmount ?? 0),
    );
    const packageValue = money(
      Number(line.packageValue ?? unitPackageValue(line.orderItem) * (line.packedQuantity ?? 1)),
    );
    const nextCod = money(Math.max(0, currentCod - packageValue));
    const currentCarrier = activeLines.find(
      (candidate) => Number(candidate.providerCodAmount ?? 0) > 0,
    ) ?? activeLines[0] ?? null;
    const nextCarrier = remaining[0] ?? null;
    const client = new MyGlsClient();

    if (!line.providerLabelCancelledAt) {
      if (currentCod > 0 && currentCarrier?.id === target.id) {
        if (Number(target.providerCodAmount ?? 0) > 0) {
          await modifyLineCod(client, target, 0);
        }
        if (nextCarrier && nextCod > 0) {
          await modifyLineCod(client, nextCarrier, nextCod);
        }
        await deleteLineLabel(client, target);
      } else {
        await deleteLineLabel(client, target);
        if (
          currentCod > 0 &&
          currentCarrier &&
          Number(currentCarrier.providerCodAmount ?? 0) !== nextCod
        ) {
          await modifyLineCod(client, currentCarrier, nextCod);
        }
      }
    } else if (
      currentCod > 0 &&
      currentCarrier &&
      Number(currentCarrier.providerCodAmount ?? 0) !== nextCod
    ) {
      await modifyLineCod(client, currentCarrier, nextCod);
    }

    const activeAfter = await db.pickupBatchLine.findMany({
      where: {
        shipmentId: line.shipmentId,
        id: { not: line.id },
        deferredAt: null,
        providerLabelCancelledAt: null,
      },
      orderBy: [{ packageNo: "asc" }, { id: "asc" }],
    });
    const label = activeAfter.length
      ? await refreshActiveLabelPdf(
          client,
          line.shipment.id,
          line.order.number,
          activeAfter,
        )
      : null;

    const finalized = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "PickupBatchLine" WHERE "id" = ${line.id} FOR UPDATE`;
      const fresh = await tx.pickupBatchLine.findUniqueOrThrow({
        where: { id: line.id },
      });
      if (fresh.deferredAt) {
        return { alreadyDeferred: true as const };
      }
      const activeAssignments = readMyGlsPackageAssignments(
        line.shipment.rawCreateResponse,
      ).filter((candidate) =>
        activeAfter.some(
          (active) => active.providerParcelId === String(candidate.parcelId),
        ),
      );
      const rawCreateResponse = updatedShipmentRaw(
        line.shipment.rawCreateResponse,
        activeAssignments,
        nextCod,
      );
      const first = activeAfter[0] ?? null;
      await tx.shipment.update({
        where: { id: line.shipment.id },
        data: {
          packageCount: activeAfter.length,
          codAmount: new Prisma.Decimal(nextCod),
          providerParcelId: first?.providerParcelId ?? null,
          providerParcelIds: activeAfter.map((item) =>
            Number(item.providerParcelId),
          ) as Prisma.InputJsonValue,
          providerParcelNumbers: activeAfter.map((item) =>
            Number(item.providerParcelNumber),
          ) as Prisma.InputJsonValue,
          providerShipmentId: first?.providerParcelId ?? null,
          providerOrderId: first?.providerClientReference ?? null,
          trackingNo: first?.providerParcelNumber ?? null,
          rawCreateResponse: rawCreateResponse as Prisma.InputJsonValue,
          status: activeAfter.length ? line.shipment.status : "FAILED",
          syncError: activeAfter.length
            ? null
            : "Svi GLS paketi su odloženi pre preuzimanja.",
          labelUrl: label?.labelUrl ?? null,
          labelObjectKey: label?.objectKey ?? null,
          labelMimeType: label?.mimeType ?? null,
          events: {
            create: {
              status: activeAfter.length ? line.shipment.status : "FAILED",
              message: `GLS paket ${line.providerParcelNumber} je odložen pre preuzimanja. Otkupnina: ${nextCod} RSD.`,
            },
          },
        },
      });
      await tx.pickupBatchLine.update({
        where: { id: line.id },
        data: {
          deferredAt: new Date(),
          deferredById: actorId,
          providerCodAmount: new Prisma.Decimal(0),
          codAdjustedAt: new Date(),
          cancellationError: null,
        },
      });
      const activeBatchLines = await tx.pickupBatchLine.count({
        where: { batchId: line.batchId, deferredAt: null },
      });
      const waitingBatchLines = await tx.pickupBatchLine.count({
        where: {
          batchId: line.batchId,
          deferredAt: null,
          courierPickedUpAt: null,
        },
      });
      await tx.pickupBatch.update({
        where: { id: line.batchId },
        data: {
          status:
            activeBatchLines === 0
              ? "CANCELLED"
              : waitingBatchLines === 0
                ? "PICKED_UP"
                : "BOOKED",
        },
      });
      await tx.orderStatusEvent.create({
        data: {
          orderId: line.orderId,
          status: line.order.status,
          actorId,
          note: `Parcijalna isporuka: paket ${line.providerParcelNumber} (${line.orderItem?.sku ?? "bez SKU"}) odložen; rezervacija ostaje aktivna. Preostala otkupnina ${nextCod} RSD.`,
        },
      });
      return { alreadyDeferred: false as const };
    }, { maxWait: 10_000, timeout: 30_000 });

    if (!finalized.alreadyDeferred) {
      try {
        const loaded = await loadOrderForEmail(line.orderId);
        if (loaded?.recipient) {
          await sendPartialDelivery({
            order: loaded.order,
            to: loaded.recipient,
            itemName: line.orderItem?.name ?? "Artikal",
            sku: line.orderItem?.sku ?? "—",
            packageValue,
            remainingCod: nextCod,
            pickupBatchLineId: line.id,
          });
        }
      } catch (error) {
        console.error("[email] partial-delivery failed", error);
      }
    }
    return {
      lineId: line.id,
      packageValue,
      remainingCod: nextCod,
      activePackageCount: activeAfter.length,
    };
  } catch (error) {
    await db.pickupBatchLine.updateMany({
      where: { id: lineId, deferredAt: null },
      data: {
        cancellationError:
          error instanceof Error ? error.message : "GLS paket nije odložen.",
      },
    });
    throw error;
  }
}

export async function rescheduleDeferredMyGlsPackage(
  lineId: string,
  actorId: string,
) {
  const source = await db.pickupBatchLine.findUnique({
    where: { id: lineId },
    include: {
      batch: { select: { provider: true } },
      order: { select: { number: true, status: true, cancelledAt: true } },
    },
  });
  if (!source || source.batch.provider !== "MYGLS") {
    throw new Error("Odloženi MyGLS paket nije pronađen.");
  }
  if (!source.deferredAt || !source.providerLabelCancelledAt) {
    throw new Error("Paket nije uspešno odložen kod GLS-a.");
  }
  if (source.rescheduledAt) {
    throw new Error("Paket je već dodat u novi nalog za preuzimanje.");
  }
  if (source.order.cancelledAt || source.order.status === "OTKAZANO") {
    throw new Error("Otkazana porudžbina ne može ponovo da se zakaže.");
  }
  const batch =
    (await db.pickupBatch.findFirst({
      where: {
        provider: "MYGLS",
        status: "DRAFT",
        labelsCreationStartedAt: null,
        labelsCreatedAt: null,
      },
      orderBy: { createdAt: "desc" },
    })) ?? (await createPickupBatch("MYGLS"));
  const now = new Date();
  const created = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "PickupBatchLine" WHERE "id" = ${source.id} FOR UPDATE`;
    const fresh = await tx.pickupBatchLine.findUniqueOrThrow({
      where: { id: source.id },
    });
    if (fresh.rescheduledAt) {
      throw new Error("Paket je već dodat u novi nalog za preuzimanje.");
    }
    const line = await tx.pickupBatchLine.create({
      data: {
        batchId: batch.id,
        orderId: source.orderId,
        orderItemId: source.orderItemId,
        purpose: "ORDER_DELIVERY",
        lineGroupKey: `order:${source.orderId}:MYGLS:deferred:${source.id}`,
        quantity: source.packedQuantity ?? 1,
        packedQuantity: source.packedQuantity ?? 1,
        packageNo: 1,
        weightKg: source.weightKg,
        widthCm: source.widthCm,
        depthCm: source.depthCm,
        heightCm: source.heightCm,
        packageValue: source.packageValue,
        deferredFromLineId: source.id,
      },
    });
    await tx.pickupBatchLine.update({
      where: { id: source.id },
      data: { rescheduledAt: now },
    });
    await tx.orderStatusEvent.create({
      data: {
        orderId: source.orderId,
        status: "U_PRIPREMI",
        actorId,
        note: `Odloženi paket je dodat u nalog ${batch.number}; rezervacija porudžbine ostaje aktivna.`,
      },
    });
    return line;
  });
  return { batchId: batch.id, batchNumber: batch.number, lineId: created.id };
}

async function claimCancellation(lineId: string, actorId: string) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "PickupBatchLine" WHERE "id" = ${lineId} FOR UPDATE`;
    const line = await tx.pickupBatchLine.findUnique({
      where: { id: lineId },
      include: {
        batch: { select: { provider: true, status: true } },
        shipment: { select: { provider: true } },
      },
    });
    if (!line || line.batch.provider !== "MYGLS" || line.shipment?.provider !== "MYGLS") {
      throw new Error("MyGLS paket nije pronađen u picking nalogu.");
    }
    if (line.purpose !== "ORDER_DELIVERY") {
      throw new Error("Parcijalno odlaganje je dostupno samo za redovne porudžbine.");
    }
    if (line.deferredAt) {
      return {
        alreadyDeferred: true as const,
        result: { lineId: line.id, alreadyDeferred: true as const },
      };
    }
    if (line.courierPickedUpAt) {
      throw new Error("Kurir je već preuzeo ovaj paket.");
    }
    if (!line.providerParcelId || !line.providerParcelNumber || !line.shipmentId) {
      throw new Error("Paket nema pouzdano sačuvan GLS identitet i ne može parcijalno da se otkaže.");
    }
    if (
      line.cancellationRequestedAt &&
      !line.cancellationError &&
      Date.now() - line.cancellationRequestedAt.getTime() < STALE_CLAIM_MS
    ) {
      throw new Error("Otkazivanje ovog paketa je već u toku.");
    }
    await tx.pickupBatchLine.update({
      where: { id: line.id },
      data: {
        cancellationRequestedAt: new Date(),
        deferredById: actorId,
        cancellationError: null,
      },
    });
    return { alreadyDeferred: false as const, result: null };
  });
}

async function loadCancellationLine(lineId: string) {
  const line = await db.pickupBatchLine.findUnique({
    where: { id: lineId },
    include: {
      order: { select: { number: true, status: true } },
      orderItem: {
        select: {
          name: true,
          sku: true,
          unitPriceSale: true,
          assemblyPrice: true,
          withAssembly: true,
        },
      },
      shipment: true,
    },
  });
  if (!line?.shipment || !line.shipmentId) {
    throw new Error("GLS pošiljka za paket nije pronađena.");
  }
  return { ...line, shipmentId: line.shipmentId, shipment: line.shipment };
}

async function assertStillWaitingAtMyGls(
  line: Awaited<ReturnType<typeof loadCancellationLine>>,
) {
  const parcelNumber = Number(line.providerParcelNumber);
  if (!Number.isFinite(parcelNumber)) {
    throw new Error("GLS broj paketa nije ispravan.");
  }
  const raw = await new MyGlsClient().getParcelStatuses({ parcelNumber });
  const events = normalizeMyGlsStatusResponses(raw, [parcelNumber]);
  if (events.some((event) => PICKED_STATUSES.has(event.status))) {
    const picked = events
      .filter((event) => PICKED_STATUSES.has(event.status))
      .sort(
        (left, right) =>
          (left.occurredAt?.getTime() ?? 0) -
          (right.occurredAt?.getTime() ?? 0),
      )[0];
    await db.pickupBatchLine.update({
      where: { id: line.id },
      data: {
        courierPickedUpAt: picked?.occurredAt ?? new Date(),
        providerStatusCode: picked?.providerStatusCode,
        providerStatusLabel: picked?.message ?? "Preuzeto iz magacina",
        providerStatusAt: picked?.occurredAt ?? new Date(),
      },
    });
    throw new Error("GLS je već preuzeo paket; otkazivanje nije dozvoljeno.");
  }
  const latest = events
    .filter((event) => event.occurredAt)
    .sort(
      (left, right) =>
        left.occurredAt!.getTime() - right.occurredAt!.getTime(),
    )
    .at(-1);
  if (latest) {
    await db.pickupBatchLine.update({
      where: { id: line.id },
      data: {
        providerStatusCode: latest.providerStatusCode,
        providerStatusLabel: latest.message ?? latest.status,
        providerStatusAt: latest.occurredAt,
      },
    });
  }
}

async function modifyLineCod(
  client: MyGlsClient,
  line: {
    id: string;
    providerParcelId: string | null;
    providerParcelNumber: string | null;
  },
  codAmount: number,
) {
  const parcelId = Number(line.providerParcelId);
  const parcelNumber = Number(line.providerParcelNumber);
  await client.modifyCOD({
    parcelId: Number.isFinite(parcelId) ? parcelId : undefined,
    parcelNumber: Number.isFinite(parcelNumber) ? parcelNumber : undefined,
    codAmount,
  });
  await db.pickupBatchLine.update({
    where: { id: line.id },
    data: {
      providerCodAmount: new Prisma.Decimal(codAmount),
      codAdjustedAt: new Date(),
    },
  });
}

async function deleteLineLabel(
  client: MyGlsClient,
  line: { id: string; providerParcelId: string | null },
) {
  const parcelId = Number(line.providerParcelId);
  if (!Number.isFinite(parcelId)) throw new Error("GLS parcel ID nije ispravan.");
  await client.deleteLabels([parcelId]);
  await db.pickupBatchLine.update({
    where: { id: line.id },
    data: { providerLabelCancelledAt: new Date() },
  });
}

async function refreshActiveLabelPdf(
  client: MyGlsClient,
  shipmentId: string,
  orderNumber: string,
  lines: readonly {
    providerParcelId: string | null;
  }[],
) {
  const parcelIds = lines.map((line) => Number(line.providerParcelId));
  if (parcelIds.some((value) => !Number.isFinite(value))) {
    throw new Error("Aktivna GLS adresnica nema parcel ID.");
  }
  const response = await client.getPrintedLabels(parcelIds);
  const bytes = bytesFromMyGls(response.Labels);
  if (!bytes.length) {
    throw new Error("GLS nije vratio osvežen PDF aktivnih adresnica.");
  }
  return uploadMyGlsLabelPdf({ shipmentId, orderNumber, bytes });
}

function updatedShipmentRaw(
  raw: unknown,
  assignments: MyGlsPackageAssignment[],
  codAmount: number,
) {
  const base =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? { ...(raw as Record<string, unknown>) }
      : {};
  delete base.myGlsParcelHandover;
  delete base.packageHandover;
  const assignment = readShipmentAssignment(raw);
  return withShipmentAssignment(
    { ...base, myGlsPackageAssignments: assignments },
    {
      orderItemIds: assignment?.orderItemIds ?? [],
      codAmount,
      supplierFulfillmentId: assignment?.supplierFulfillmentId,
      assignmentKey: assignment?.assignmentKey,
    },
  );
}

function unitPackageValue(item: {
  unitPriceSale: Prisma.Decimal;
  assemblyPrice: Prisma.Decimal | null;
  withAssembly: boolean;
} | null) {
  if (!item) return 0;
  return Number(item.unitPriceSale) +
    (item.withAssembly ? Number(item.assemblyPrice ?? 0) : 0);
}

function money(value: number) {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
}
