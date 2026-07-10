import "server-only";

import { randomUUID } from "node:crypto";
import { Prisma, type PaymentStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { SHIPMENT_STATUS_LABEL } from "@/lib/courier/status";
import { MYGLS_PROVIDER, MyGlsConfigError, MyGlsProviderError, requireMyGlsEnabled } from "./config";
import { MyGlsClient, bytesFromMyGls } from "./client";
import { uploadMyGlsLabelPdf } from "./labels";
import { buildMyGlsParcelForOrder, isMyGlsCashOnDelivery } from "./payload";

const PAID_STATUSES: PaymentStatus[] = ["AUTHORIZED", "PAID"];

export async function createMyGlsShipmentForOrder(orderId: string) {
  const cfg = requireMyGlsEnabled();
  const order = await db.order.findUnique({
    where: { id: orderId },
    include: {
      user: { select: { email: true } },
      items: { select: { qty: true, name: true, withAssembly: true } },
      payments: {
        orderBy: { createdAt: "desc" },
        select: { status: true, method: true, providerRef: true },
      },
      shipments: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  if (!order) throw new Error(`Order ${orderId} ne postoji.`);
  if (order.shippingMethod !== "KURIR") {
    throw new MyGlsConfigError("MyGLS se koristi samo za kurirsku isporuku.");
  }
  if (order.items.some((item) => item.withAssembly)) {
    throw new MyGlsConfigError("Porudžbina sa montažom/kamionskom logikom ne šalje se kroz MyGLS.");
  }

  const existing = order.shipments[0];
  if (existing && existing.provider === MYGLS_PROVIDER && existing.status !== "FAILED") {
    return existing;
  }

  if (!isMyGlsCashOnDelivery(order.paymentMethod)) {
    const paid = order.payments.some((p) => PAID_STATUSES.includes(p.status));
    if (!paid) {
      throw new MyGlsConfigError(
        "Prepaid porudžbina mora imati uspešno/autorizovano plaćanje pre slanja kroz MyGLS.",
      );
    }
  }

  const shipmentId = existing?.provider === MYGLS_PROVIDER ? existing.id : randomUUID();
  const parcel = buildMyGlsParcelForOrder({ cfg, order });

  try {
    const response = await new MyGlsClient(cfg).printLabels({ parcelList: [parcel] });
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

    const data = {
      provider: MYGLS_PROVIDER,
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
      rawCreateResponse: response as Prisma.InputJsonValue,
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
              raw: response as Prisma.InputJsonValue,
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
            raw: response as Prisma.InputJsonValue,
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
      message,
      raw: err instanceof MyGlsProviderError ? err.raw : undefined,
    });
    throw err;
  }
}

export async function deleteMyGlsLabelsForShipment(shipmentId: string) {
  const shipment = await db.shipment.findUnique({
    where: { id: shipmentId },
    select: { id: true, orderId: true, provider: true, providerParcelId: true, providerParcelIds: true },
  });
  if (!shipment || shipment.provider !== MYGLS_PROVIDER) {
    throw new MyGlsConfigError("MyGLS pošiljka nije pronađena.");
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
  message: string;
  raw?: unknown;
}) {
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
      status: "FAILED",
      syncError: args.message,
      events: { create: event },
    },
  });
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
