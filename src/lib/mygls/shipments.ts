import { assertMyGlsReturnAccepted, myGlsReturnBooking } from "./return-booking";
import { boxQuantity } from "@/lib/courier/label-quantity";
import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { Prisma, type ShipmentPurpose } from "@prisma/client";
import { db } from "@/lib/db";
import type { PhysicalPackage } from "@/lib/courier/packages";
import { SHIPMENT_STATUS_LABEL } from "@/lib/courier/status";
import {
  MYGLS_PROVIDER,
  MyGlsConfigError,
  MyGlsProviderError,
  requireMyGlsEnabled,
  type MyGlsPickupAddress,
} from "./config";
import { MyGlsClient, bytesFromMyGls } from "./client";
import { uploadMyGlsLabelPdf } from "./labels";
import { buildMyGlsParcelsForOrder } from "./payload";
import {
  normalizeOrderItemIds,
  sameShipmentAssignment,
  withShipmentAssignment,
} from "@/lib/courier/shipment-assignment";
import { assertFulfillmentPaymentReady } from "@/lib/payments/fulfillment-readiness";

type MyGlsShipmentOptions = {
  purpose?: ShipmentPurpose;
  reclamationId?: string;
  pickupDate?: Date;
  packages?: readonly PhysicalPackage[];
  orderItemIds?: string[];
  codAmount?: number;
  supplierFulfillmentId?: string;
  pickupOverride?: MyGlsPickupAddress;
  assignmentKey?: string;
};

export type MyGlsPackageAssignment = {
  packageNo: number;
  orderItemId: string | null;
  clientReference: string;
  parcelId: number;
  parcelNumber: number;
  codAmount: number;
  packedQuantity?: number;
};

/**
 * Build and validate the exact provider payload without creating a label.
 * Pickup batches use this for every group before the first PrintLabels call,
 * so a bad address or service configuration cannot leave a partial batch in
 * MyGLS.
 */
export async function preflightMyGlsShipmentForOrder(
  orderId: string,
  options: MyGlsShipmentOptions = {},
) {
  await prepareMyGlsShipmentForOrder(orderId, options);
}

export async function createMyGlsShipmentForOrder(
  orderId: string,
  options: MyGlsShipmentOptions = {},
) {
  const prepared = await prepareMyGlsShipmentForOrder(orderId, options);
  if (prepared.completedShipment) {
    return prepared.completedShipment.purpose === "RECLAMATION_RETURN"
      ? ensureMyGlsReturnDocument(prepared.completedShipment)
      : prepared.completedShipment;
  }
  if (prepared.purpose === "RECLAMATION_RETURN") {
    return createMyGlsReturnShipment(prepared, options);
  }

  const {
    cfg,
    purpose,
    reclamation,
    order,
    assignmentOrderItemIds,
    codAmount,
    existing,
    shipmentId,
    parcelList,
  } = prepared;

  try {
    const response = await new MyGlsClient(cfg).printLabels({ parcelList });
    const printData =
      response.PrintLabelsInfoList ?? response.PrintDataInfoList ?? [];
    const first = printData[0] ?? {};
    const parcelIds = printData.map((item) => item.ParcelId).filter(isNumber);
    const parcelNumbers = printData
      .map((item) => item.ParcelNumberWithCheckdigit ?? item.ParcelNumber)
      .filter(isNumber);
    const packageAssignments = buildPackageAssignments(
      parcelList,
      options.packages ?? [],
      printData,
    );
    const trackingNo = String(
      parcelNumbers[0] ?? first.ParcelNumber ?? first.ParcelId ?? order.number,
    );
    const labelBytes = bytesFromMyGls(response.Labels);
    const label = await uploadMyGlsLabelPdf({
      shipmentId,
      orderNumber: order.number,
      bytes: labelBytes,
    });
    const sanitizedResponse = {
      ...response,
      Labels: Array.from(label.bytes),
      myGlsPackageAssignments: packageAssignments,
    };

    const data = {
      provider: MYGLS_PROVIDER,
      packageCount: parcelList.reduce((sum, parcel) => sum + parcel.Count, 0),
      purpose,
      reclamationId: reclamation?.id ?? null,
      reclamationQty: reclamation?.quantity ?? null,
      warehouseId: reclamation?.warehouseId ?? null,
      providerOrderId: first.ClientReference ?? order.number,
      providerShipmentId: first.ParcelId ? String(first.ParcelId) : null,
      providerParcelId: first.ParcelId ? String(first.ParcelId) : null,
      providerParcelIds: parcelIds as Prisma.InputJsonValue,
      providerParcelNumbers: parcelNumbers as Prisma.InputJsonValue,
      codAmount: new Prisma.Decimal(codAmount),
      trackingNo,
      labelUrl: label.labelUrl,
      labelObjectKey: label.objectKey,
      labelMimeType: label.mimeType,
      status: "CREATED" as const,
      providerStatusCode: null,
      rawCreateResponse: withShipmentAssignment(sanitizedResponse, {
        orderItemIds: assignmentOrderItemIds,
        codAmount,
        supplierFulfillmentId: options.supplierFulfillmentId,
        assignmentKey: options.assignmentKey,
      }) as Prisma.InputJsonValue,
      syncError: null,
    };

    if (existing?.provider === MYGLS_PROVIDER) {
      return db.shipment.update({
        where: { id: existing.id },
        data: {
          ...data,
          events: {
            create: {
              status: "CREATED",
              message: "MyGLS nalog kreiran",
              raw: sanitizedResponse as unknown as Prisma.InputJsonValue,
            },
          },
        },
      });
    }

    return db.shipment.create({
      data: {
        id: shipmentId,
        orderId: order.id,
        service: "COURIER_SMALL",
        ...data,
        events: {
          create: {
            status: "CREATED",
            message: "MyGLS nalog kreiran",
            raw: sanitizedResponse as unknown as Prisma.InputJsonValue,
          },
        },
      },
    });
  } catch (err) {
    const message =
      err instanceof MyGlsProviderError || err instanceof MyGlsConfigError
        ? err.message
        : err instanceof Error
          ? err.message
          : "MyGLS nalog nije kreiran.";
    await persistFailedShipment({
      orderId: order.id,
      existingShipmentId:
        existing?.provider === MYGLS_PROVIDER ? existing.id : undefined,
      purpose,
      reclamationId: reclamation?.id,
      reclamationQty: reclamation?.quantity,
      warehouseId: reclamation?.warehouseId,
      message,
      raw: err instanceof MyGlsProviderError ? err.raw : undefined,
      orderItemIds: assignmentOrderItemIds,
      codAmount,
      supplierFulfillmentId: options.supplierFulfillmentId,
      assignmentKey: options.assignmentKey,
    });
    throw err;
  }
}

async function prepareMyGlsShipmentForOrder(
  orderId: string,
  options: MyGlsShipmentOptions,
) {
  const cfg = requireMyGlsEnabled(options.pickupOverride);
  const purpose = options.purpose ?? "ORDER_DELIVERY";
  const reclamation =
    purpose === "ORDER_DELIVERY"
      ? null
      : await db.reclamation.findUnique({
          where: { id: options.reclamationId ?? "" },
          select: {
            id: true,
            orderId: true,
            orderItemId: true,
            quantity: true,
            warehouseId: true,
          },
        });
  if (
    purpose !== "ORDER_DELIVERY" &&
    (!reclamation || reclamation.orderId !== orderId)
  ) {
    throw new MyGlsConfigError("Reklamacija za kurirski nalog nije pronađena.");
  }
  const order = await db.order.findUnique({
    where: { id: orderId },
    include: {
      user: { select: { email: true } },
      items: {
        select: {
          id: true, qty: true, name: true, sku: true, withAssembly: true,
          product: { select: { barcode: true } },
        },
      },
      payments: {
        orderBy: { createdAt: "desc" },
        select: { status: true, method: true, providerRef: true },
      },
      shipments: {
        where: {
          purpose,
          reclamationId: reclamation?.id ?? null,
        },
        orderBy: { createdAt: "desc" },
      },
    },
  });
  if (!order) throw new Error(`Order ${orderId} ne postoji.`);
  if (order.shippingMethod !== "KURIR") {
    throw new MyGlsConfigError("MyGLS se koristi samo za kurirsku isporuku.");
  }
  const requestedOrderItemIds = normalizeOrderItemIds(options.orderItemIds);
  const shipmentItems = reclamation
    ? order.items
        .filter((item) => item.id === reclamation.orderItemId)
        .map((item) => ({ ...item, qty: reclamation.quantity }))
    : requestedOrderItemIds.length
      ? order.items.filter((item) => requestedOrderItemIds.includes(item.id))
      : order.items;
  if (!shipmentItems.length) {
    throw new MyGlsConfigError(
      "Stavka reklamacije nije pronađena u porudžbini.",
    );
  }
  if (
    requestedOrderItemIds.length &&
    shipmentItems.length !== requestedOrderItemIds.length
  ) {
    throw new MyGlsConfigError(
      "Jedna od izabranih stavki ne pripada ovoj porudžbini.",
    );
  }
  if (shipmentItems.some((item) => item.withAssembly)) {
    throw new MyGlsConfigError(
      "Porudžbina sa montažom/kamionskom logikom ne šalje se kroz MyGLS.",
    );
  }

  const assignmentOrderItemIds = normalizeOrderItemIds(
    shipmentItems.map((item) => item.id),
  );
  const codAmount = purpose !== "ORDER_DELIVERY" ? 0 :
    Number.isFinite(options.codAmount) && Number(options.codAmount) >= 0
      ? Number(options.codAmount)
      : Number(order.total);
  const existing = order.shipments.find(
    (shipment) =>
      shipment.provider === MYGLS_PROVIDER &&
      (!requestedOrderItemIds.length ||
        sameShipmentAssignment(
          shipment.rawCreateResponse,
          assignmentOrderItemIds,
          options.assignmentKey,
        )),
  );
  assertFulfillmentPaymentReady({
    orderNumber: order.number,
    purpose,
    paymentMethod: order.paymentMethod,
    paymentStatuses: order.payments.map((payment) => payment.status),
  });
  if (existing && purpose === "RECLAMATION_RETURN" &&
      existing.syncError !== "MyGLS etiketa obrisana." &&
      myGlsReturnBooking(existing).state !== "REJECTED") {
    assertMyGlsReturnAccepted(existing);
  }
  if (
    existing &&
    existing.provider === MYGLS_PROVIDER &&
    existing.status !== "FAILED"
  ) {
    return { completedShipment: existing } as const;
  }

  const shipmentId =
    existing?.provider === MYGLS_PROVIDER ? existing.id : randomUUID();
  const parcelList = buildMyGlsParcelsForOrder({
    cfg,
    order: { ...order, total: codAmount, items: shipmentItems },
    pickupDate: purpose === "RECLAMATION_RETURN" ? returnPickupDate(options.pickupDate) : options.pickupDate,
    packages: options.packages ?? [],
    purpose,
    pickupContactOnLabel: Boolean(options.supplierFulfillmentId),
    clientReferenceSuffix: purpose === "RECLAMATION_RETURN" && reclamation
      ? `R${createHash("sha256").update(reclamation.id).digest("hex").slice(0, 12)}`
      : deferredReferenceSuffix(options.assignmentKey),
  });

  return {
    completedShipment: null,
    cfg,
    purpose,
    reclamation,
    order,
    assignmentOrderItemIds,
    codAmount,
    existing,
    shipmentId,
    parcelList,
  } as const;
}

function deferredReferenceSuffix(assignmentKey?: string) {
  if (assignmentKey?.startsWith("reshipment:")) {
    return `S${assignmentKey.slice("reshipment:".length).replace(/[^a-z0-9]/gi, "").slice(-12)}`;
  }
  const deferredId = assignmentKey?.split(":deferred:")[1]?.trim();
  if (!deferredId) return undefined;
  return `R${deferredId.replace(/[^a-z0-9]/gi, "").slice(-8)}`;
}

export async function deleteMyGlsLabelsForShipment(shipmentId: string) {
  const shipment = await db.shipment.findUnique({
    where: { id: shipmentId },
    select: {
      id: true,
      orderId: true,
      provider: true,
      providerParcelId: true,
      providerParcelIds: true,
      syncError: true,
      purpose: true,
      providerParcelNumbers: true,
      trackingNo: true,
    },
  });
  if (!shipment || shipment.provider !== MYGLS_PROVIDER) {
    throw new MyGlsConfigError("MyGLS pošiljka nije pronađena.");
  }
  if (shipment.syncError === "MyGLS etiketa obrisana.") {
    return { alreadyDeleted: true };
  }
  const parcelIds = parcelIdList(shipment);
  if (!parcelIds.length)
    throw new MyGlsConfigError("MyGLS parcel ID nije sačuvan.");
  const client = new MyGlsClient();
  if (shipment.purpose === "RECLAMATION_RETURN") {
    const numbers = parcelNumberList(shipment);
    if (!numbers.length) throw new MyGlsConfigError("Proverite ishod P&R zahteva u MyGLS-u pre otkazivanja.");
    for (const parcelNumber of numbers) {
      const live = await client.getParcelStatuses({ parcelNumber });
      if (live.ParcelNumber !== parcelNumber || !live.ParcelStatusList?.length ||
          live.ParcelStatusList.some(event => !["51", "52"].includes(String(event.StatusCode).replace(/^0+/, "")))) {
        throw new MyGlsConfigError("P&R pošiljka ima promenu statusa ili nepotpun odgovor. Proverite preuzimanje kod GLS-a pre otkazivanja.");
      }
    }
  }
  const response = await client.deleteLabels(parcelIds);
  await db.shipment.update({
    where: { id: shipment.id },
    data: {
      status: "FAILED",
      syncError: "MyGLS etiketa obrisana.",
      events: {
        create: {
          status: "FAILED",
          message: "MyGLS etiketa obrisana",
          raw: response as Prisma.InputJsonValue,
        },
      },
    },
  });
  return response;
}

export async function modifyMyGlsCODForShipment(
  shipmentId: string,
  codAmount: number,
) {
  const shipment = await db.shipment.findUnique({
    where: { id: shipmentId },
    select: {
      id: true,
      provider: true,
      providerParcelId: true,
      providerParcelIds: true,
      providerParcelNumbers: true,
      trackingNo: true,
      status: true,
    },
  });
  if (!shipment || shipment.provider !== MYGLS_PROVIDER) {
    throw new MyGlsConfigError("MyGLS pošiljka nije pronađena.");
  }
  const parcelId = parcelIdList(shipment)[0];
  const parcelNumber = parcelNumberList(shipment)[0];
  const response = await new MyGlsClient().modifyCOD({
    parcelId,
    parcelNumber,
    codAmount,
  });
  await db.shipmentEvent.create({
    data: {
      shipmentId: shipment.id,
      status: shipment.status,
      message: `MyGLS COD izmenjen na ${codAmount} RSD`,
      raw: response as Prisma.InputJsonValue,
    },
  });
  return response;
}

export function parcelIdList(shipment: {
  providerParcelId?: string | null;
  providerParcelIds?: unknown;
}) {
  const ids = Array.isArray(shipment.providerParcelIds)
    ? shipment.providerParcelIds.map(Number).filter(Number.isFinite)
    : [];
  const single = shipment.providerParcelId
    ? Number(shipment.providerParcelId)
    : null;
  return [...new Set([...(single ? [single] : []), ...ids])];
}

export function parcelNumberList(shipment: {
  trackingNo?: string | null;
  providerParcelNumbers?: unknown;
}) {
  const numbers = Array.isArray(shipment.providerParcelNumbers)
    ? shipment.providerParcelNumbers.map(Number).filter(Number.isFinite)
    : [];
  const single = shipment.trackingNo ? Number(shipment.trackingNo) : null;
  return [
    ...new Set([
      ...(single && Number.isFinite(single) ? [single] : []),
      ...numbers,
    ]),
  ];
}

async function persistFailedShipment(args: {
  orderId: string;
  existingShipmentId?: string;
  purpose: ShipmentPurpose;
  reclamationId?: string;
  reclamationQty?: number;
  warehouseId?: string | null;
  message: string;
  raw?: unknown;
  orderItemIds: string[];
  codAmount: number;
  supplierFulfillmentId?: string;
  assignmentKey?: string;
}) {
  const rawCreateResponse = withShipmentAssignment(args.raw, {
    orderItemIds: args.orderItemIds,
    codAmount: args.codAmount,
    supplierFulfillmentId: args.supplierFulfillmentId,
    assignmentKey: args.assignmentKey,
  });
  const event = {
    status: "FAILED" as const,
    message: `MyGLS greška: ${args.message || SHIPMENT_STATUS_LABEL.FAILED}`,
    raw: args.raw as Prisma.InputJsonValue | undefined,
  };
  if (args.existingShipmentId) {
    await db.shipment.update({
      where: { id: args.existingShipmentId },
      data: {
        status: "FAILED",
        rawCreateResponse: rawCreateResponse as Prisma.InputJsonValue,
        syncError: args.message,
        events: { create: event },
      },
    });
    return;
  }

  await db.shipment.create({
    data: {
      orderId: args.orderId,
      service: "COURIER_SMALL",
      provider: MYGLS_PROVIDER,
      purpose: args.purpose,
      reclamationId: args.reclamationId ?? null,
      reclamationQty: args.reclamationQty ?? null,
      warehouseId: args.warehouseId ?? null,
      status: "FAILED",
      rawCreateResponse: rawCreateResponse as Prisma.InputJsonValue,
      syncError: args.message,
      events: { create: event },
    },
  });
}

function buildPackageAssignments(
  parcelList: readonly { ClientReference: string; CODAmount?: number }[],
  packages: readonly PhysicalPackage[],
  printData: readonly {
    ClientReference?: string;
    ParcelId?: number;
    ParcelNumber?: number;
    ParcelNumberWithCheckdigit?: number;
  }[],
): MyGlsPackageAssignment[] {
  if (parcelList.length !== packages.length) {
    throw new MyGlsProviderError(
      "MyGLS nije kreirao po jedan adresabilan paket za svaki prodati komad.",
    );
  }
  const byReference = new Map(
    printData.map((item) => [String(item.ClientReference ?? ""), item]),
  );
  return parcelList.map((parcel, index) => {
    const response = byReference.get(parcel.ClientReference);
    const parcelId = response?.ParcelId;
    const parcelNumber =
      response?.ParcelNumberWithCheckdigit ?? response?.ParcelNumber;
    if (!isNumber(parcelId) || !isNumber(parcelNumber)) {
      throw new MyGlsProviderError(
        `MyGLS odgovor nema identitet paketa ${parcel.ClientReference}.`,
      );
    }
    return {
      packedQuantity: boxQuantity(packages[index]!),
      packageNo: packages[index]?.packageNo ?? index + 1,
      orderItemId: packages[index]?.orderItemId ?? null,
      clientReference: parcel.ClientReference,
      parcelId,
      parcelNumber,
      codAmount: Number(parcel.CODAmount ?? 0),
    };
  });
}

export function readMyGlsPackageAssignments(
  raw: unknown,
): MyGlsPackageAssignment[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  const value = (raw as Record<string, unknown>).myGlsPackageAssignments;
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const item = entry as Record<string, unknown>;
    const packageNo = Number(item.packageNo);
    const parcelId = Number(item.parcelId);
    const parcelNumber = Number(item.parcelNumber);
    if (
      !Number.isInteger(packageNo) ||
      packageNo < 1 ||
      !Number.isFinite(parcelId) ||
      !Number.isFinite(parcelNumber)
    ) return [];
    return [{
      packageNo,
      ...(Number.isSafeInteger(item.packedQuantity) && Number(item.packedQuantity) > 0 ? { packedQuantity: Number(item.packedQuantity) } : {}),
      orderItemId:
        typeof item.orderItemId === "string" ? item.orderItemId : null,
      clientReference: String(item.clientReference ?? ""),
      parcelId,
      parcelNumber,
      codAmount: Math.max(0, Number(item.codAmount ?? 0) || 0),
    }];
  });
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** A calendar date in Serbia; weekends move to the next business day. */
function returnPickupDate(requested?: Date) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Belgrade", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const date = requested ? new Date(requested) : new Date(`${today}T12:00:00Z`);
  if (!requested) date.setUTCDate(date.getUTCDate() + 1);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) <= today) {
    throw new MyGlsConfigError("GLS P&R preuzimanje zakažite najranije za naredni radni dan.");
  }
  while ([0, 6].includes(date.getUTCDay())) date.setUTCDate(date.getUTCDate() + 1);
  return date;
}

type PreparedShipment = Extract<Awaited<ReturnType<typeof prepareMyGlsShipmentForOrder>>, { completedShipment: null }>;

async function createMyGlsReturnShipment(prepared: PreparedShipment, options: MyGlsShipmentOptions) {
  const { cfg, order, reclamation, existing, shipmentId, parcelList, assignmentOrderItemIds } = prepared;
  const pickupMillis = Number(parcelList[0].PickupDate?.match(/\d+/)?.[0]);
  const booking = {
    state: "PENDING", service: "PRS", pickupDate: new Date(pickupMillis).toISOString().slice(0, 10),
    references: parcelList.map(parcel => parcel.ClientReference),
    requestedAt: new Date().toISOString(),
  };
  const pending = {
    provider: MYGLS_PROVIDER, purpose: "RECLAMATION_RETURN" as const,
    reclamationId: reclamation!.id, reclamationQty: reclamation!.quantity,
    warehouseId: reclamation!.warehouseId, packageCount: parcelList.length,
    status: "CREATED" as const, providerStatusCode: null,
    providerOrderId: parcelList[0].ClientReference, providerShipmentId: null,
    providerParcelId: null, providerParcelIds: [], providerParcelNumbers: [],
    trackingNo: null, labelUrl: null, labelObjectKey: null, labelMimeType: null,
    lastStatusSyncAt: null, lastStatusEventAt: null, shippedAt: null, deliveredAt: null,
    codAmount: new Prisma.Decimal(0), syncError: "GLS P&R zahtev se šalje; ne šaljite ponovo.",
    rawCreateResponse: { myGlsReturn: booking } as Prisma.InputJsonValue,
  };
  // Claim the unique reclamation/purpose row before external I/O. A second click
  // cannot send another courier request, including across multiple app instances.
  if (existing) {
    const claimed = await db.shipment.updateMany({
      where: { id: shipmentId, status: "FAILED", rawCreateResponse: { equals: existing.rawCreateResponse ?? Prisma.JsonNull } },
      data: pending,
    });
    if (claimed.count !== 1) throw new MyGlsConfigError("P&R zahtev je već pokrenut. Osvežite reklamaciju.");
  } else {
    try {
      await db.shipment.create({ data: { ...pending, id: shipmentId, orderId: order.id, service: "COURIER_SMALL" } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new MyGlsConfigError("P&R zahtev je već pokrenut. Osvežite reklamaciju.");
      }
      throw error;
    }
  }
  let accepted = false;
  let response: Awaited<ReturnType<MyGlsClient["printLabels"]>> | undefined;
  try {
    response = await new MyGlsClient(cfg).printLabels({ parcelList });
    const info = response.PrintLabelsInfoList ?? response.PrintDataInfoList ?? [];
    const expected = new Set(booking.references);
    if (info.length !== parcelList.length || new Set(info.map(row => row.ClientReference)).size !== expected.size ||
        info.some(row => !expected.has(row.ClientReference ?? "") || !row.ParcelId || !(row.ParcelNumber ?? row.ParcelNumberWithCheckdigit))) {
      throw new MyGlsProviderError("GLS nije potvrdio sve P&R pakete. Proverite ishod pre ponovnog slanja.", undefined, response);
    }
    const raw = withShipmentAssignment({
      ...response,
      myGlsReturn: { ...booking, state: "ACCEPTED", acceptedAt: new Date().toISOString() },
      myGlsPackageAssignments: buildPackageAssignments(parcelList, options.packages ?? [], info),
    }, { orderItemIds: assignmentOrderItemIds, codAmount: 0 });
    // Save provider identity and confirmation BEFORE storage. A storage failure
    // can then be retried without calling PrintLabels / booking a second pickup.
    const saved = await db.shipment.update({ where: { id: shipmentId }, data: {
      providerShipmentId: String(info[0].ParcelId), providerParcelId: String(info[0].ParcelId),
      providerParcelIds: info.map(row => row.ParcelId!),
      providerParcelNumbers: info.map(row => row.ParcelNumber ?? row.ParcelNumberWithCheckdigit!),
      trackingNo: String(info[0].ParcelNumber ?? info[0].ParcelNumberWithCheckdigit),
      rawCreateResponse: raw as Prisma.InputJsonValue, syncError: null,
      events: { create: { status: "CREATED", message: `GLS P&R zahtev prihvaćen za ${booking.pickupDate}; čeka preuzimanje kod kupca.`, raw: { references: booking.references, pickupDate: booking.pickupDate, service: "PRS" } } },
    } });
    accepted = true;
    return await ensureMyGlsReturnDocument(saved);
  } catch (error) {
    if (!accepted) {
      const raw = response ?? (error instanceof MyGlsProviderError ? error.raw : null);
      const details = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
      const rejected = error instanceof MyGlsProviderError && error.definitiveRejection && parcelList.length === 1 && !response &&
        Array.isArray(details.PrintLabelsErrorList) && details.PrintLabelsErrorList.length > 0 &&
        !(Array.isArray(details.PrintLabelsInfoList) && details.PrintLabelsInfoList.length > 0) &&
        !(Array.isArray(details.PrintDataInfoList) && details.PrintDataInfoList.length > 0);
      await db.shipment.update({ where: { id: shipmentId }, data: {
        status: rejected ? "FAILED" : "CREATED",
        syncError: `${rejected ? "GLS je odbio P&R zahtev" : "Ishod GLS P&R zahteva nije potvrđen; ne šaljite ponovo"}: ${error instanceof Error ? error.message : "Greška provajdera"}`,
        rawCreateResponse: { providerResponse: raw ?? null, myGlsReturn: { ...booking, state: rejected ? "REJECTED" : "UNKNOWN" } } as Prisma.InputJsonValue,
      } });
    }
    throw error;
  }
}

export async function ensureMyGlsReturnDocument(shipment: {
  id: string; purpose: string; provider: string | null; status: string;
  labelObjectKey: string | null; rawCreateResponse: unknown;
  providerParcelId: string | null; trackingNo: string | null; syncError: string | null;
}) {
  assertMyGlsReturnAccepted(shipment);
  // Always return a complete DB row, consistent with the general creation API.
  if (shipment.labelObjectKey) return db.shipment.findUniqueOrThrow({ where: { id: shipment.id } });
  const raw = shipment.rawCreateResponse as Record<string, unknown>;
  const stored = await db.shipment.findUniqueOrThrow({ where: { id: shipment.id }, select: { order: { select: { number: true } } } });
  const label = await uploadMyGlsLabelPdf({ shipmentId: shipment.id, orderNumber: stored.order.number, bytes: bytesFromMyGls(raw.Labels) });
  return db.shipment.update({ where: { id: shipment.id }, data: { labelObjectKey: label.objectKey, labelUrl: label.labelUrl, labelMimeType: label.mimeType, syncError: null } });
}
