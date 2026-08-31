import "server-only";

import { randomUUID } from "node:crypto";
import {
  Prisma,
  type ShipmentPurpose,
} from "@prisma/client";
import { db } from "@/lib/db";
import type { PhysicalPackage } from "@/lib/courier/packages";
import { SHIPMENT_STATUS_LABEL } from "@/lib/courier/status";
import { MYGLS_PROVIDER, MyGlsConfigError, MyGlsProviderError, requireMyGlsEnabled, type MyGlsPickupAddress } from "./config";
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
  if (prepared.completedShipment) return prepared.completedShipment;

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
    const printData = response.PrintLabelsInfoList ?? response.PrintDataInfoList ?? [];
    const first = printData[0] ?? {};
    const parcelIds = printData.map((item) => item.ParcelId).filter(isNumber);
    const parcelNumbers = printData
      .map((item) => item.ParcelNumberWithCheckdigit ?? item.ParcelNumber)
      .filter(isNumber);
    const trackingNo = String(parcelNumbers[0] ?? first.ParcelNumber ?? first.ParcelId ?? order.number);
    const labelBytes = bytesFromMyGls(response.Labels);
    const label = await uploadMyGlsLabelPdf({
      shipmentId,
      orderNumber: order.number,
      bytes: labelBytes,
    });
    const sanitizedResponse = {
      ...response,
      Labels: Array.from(label.bytes),
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
      existingShipmentId: existing?.provider === MYGLS_PROVIDER ? existing.id : undefined,
      purpose,
      reclamationId: reclamation?.id,
      reclamationQty: reclamation?.quantity,
      warehouseId: reclamation?.warehouseId,
      message,
      raw: err instanceof MyGlsProviderError ? err.raw : undefined,
      orderItemIds: assignmentOrderItemIds,
      codAmount,
      supplierFulfillmentId: options.supplierFulfillmentId,
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
  if (purpose !== "ORDER_DELIVERY" && (!reclamation || reclamation.orderId !== orderId)) {
    throw new MyGlsConfigError("Reklamacija za kurirski nalog nije pronađena.");
  }
  const order = await db.order.findUnique({
    where: { id: orderId },
    include: {
      user: { select: { email: true } },
      items: { select: { id: true, qty: true, name: true, withAssembly: true } },
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
    throw new MyGlsConfigError("Stavka reklamacije nije pronađena u porudžbini.");
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
    throw new MyGlsConfigError("Porudžbina sa montažom/kamionskom logikom ne šalje se kroz MyGLS.");
  }

  const assignmentOrderItemIds = normalizeOrderItemIds(
    shipmentItems.map((item) => item.id),
  );
  const codAmount =
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
        )),
  );
  assertFulfillmentPaymentReady({
    orderNumber: order.number,
    purpose,
    paymentMethod: order.paymentMethod,
    paymentStatuses: order.payments.map((payment) => payment.status),
  });
  if (existing && existing.provider === MYGLS_PROVIDER && existing.status !== "FAILED") {
    return { completedShipment: existing } as const;
  }

  const shipmentId = existing?.provider === MYGLS_PROVIDER ? existing.id : randomUUID();
  const parcelList = buildMyGlsParcelsForOrder({
    cfg,
    order: { ...order, total: codAmount, items: shipmentItems },
    pickupDate: options.pickupDate,
    packages: options.packages ?? [],
    purpose,
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
    },
  });
  if (!shipment || shipment.provider !== MYGLS_PROVIDER) {
    throw new MyGlsConfigError("MyGLS pošiljka nije pronađena.");
  }
  if (shipment.syncError === "MyGLS etiketa obrisana.") {
    return { alreadyDeleted: true };
  }
  const parcelIds = parcelIdList(shipment);
  if (!parcelIds.length) throw new MyGlsConfigError("MyGLS parcel ID nije sačuvan.");
  const response = await new MyGlsClient().deleteLabels(parcelIds);
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

export async function modifyMyGlsCODForShipment(shipmentId: string, codAmount: number) {
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

export function parcelIdList(shipment: { providerParcelId?: string | null; providerParcelIds?: unknown }) {
  const ids = Array.isArray(shipment.providerParcelIds)
    ? shipment.providerParcelIds.map(Number).filter(Number.isFinite)
    : [];
  const single = shipment.providerParcelId ? Number(shipment.providerParcelId) : null;
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
  return [...new Set([...(single && Number.isFinite(single) ? [single] : []), ...numbers])];
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
}) {
  const rawCreateResponse = withShipmentAssignment(args.raw, {
    orderItemIds: args.orderItemIds,
    codAmount: args.codAmount,
    supplierFulfillmentId: args.supplierFulfillmentId,
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

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
