import "server-only";

import { Prisma, type PaymentStatus } from "@prisma/client";
import { db } from "@/lib/db";
import {
  X_EXPRESS_PROVIDER,
  XExpressConfigError,
  XExpressProviderError,
  requireXExpressEnabled,
} from "./config";
import { allocateXExpressTrackingCode } from "./code";
import { XExpressClient } from "./client";
import { buildXExpressCreateOrderPayload, isXExpressCashOnDelivery } from "./payload";

const PAID_STATUSES: PaymentStatus[] = ["AUTHORIZED", "PAID"];

export async function createXExpressShipmentForOrder(orderId: string) {
  const cfg = requireXExpressEnabled();
  const order = await db.order.findUnique({
    where: { id: orderId },
    include: {
      items: { select: { qty: true, withAssembly: true } },
      payments: {
        orderBy: { createdAt: "desc" },
        select: { status: true, method: true, providerRef: true },
      },
      shipments: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  if (!order) throw new Error(`Order ${orderId} ne postoji.`);
  if (order.shippingMethod !== "KURIR") {
    throw new XExpressConfigError("X Express se koristi samo za kurirsku isporuku.");
  }
  if (order.items.some((item) => item.withAssembly)) {
    throw new XExpressConfigError(
      "Porudžbina ima montažu/kamionsku logiku i ne šalje se kroz X Express.",
    );
  }

  const existing = order.shipments[0];
  if (
    existing &&
    existing.provider === X_EXPRESS_PROVIDER &&
    existing.status !== "FAILED"
  ) {
    return existing;
  }

  if (!isXExpressCashOnDelivery(order.paymentMethod)) {
    const paid = order.payments.some((p) => PAID_STATUSES.includes(p.status));
    if (!paid) {
      throw new XExpressConfigError(
        "Prepaid porudžbina mora imati uspešno/autorizovano plaćanje pre slanja kuriru.",
      );
    }
  }

  const trackingNo =
    existing?.provider === X_EXPRESS_PROVIDER && existing.trackingNo
      ? existing.trackingNo
      : (await db.$transaction((tx) => allocateXExpressTrackingCode(tx))).trackingNo;
  const location = await findLocationForOrder(order.shipCity, order.shipPostalCode);
  const payload = buildXExpressCreateOrderPayload({
    contractCode: cfg.contractCode,
    trackingNo,
    order,
    location,
  });

  try {
    const result = await new XExpressClient(cfg).createOrder(payload);
    const data = {
      provider: X_EXPRESS_PROVIDER,
      providerOrderId: result.providerOrderId ?? null,
      providerShipmentId: result.providerShipmentId ?? null,
      trackingNo: result.trackingNo,
      labelUrl: result.labelUrl ?? null,
      status: "CREATED" as const,
      providerStatusCode: result.providerStatusCode ?? null,
      rawCreateResponse: result.raw as Prisma.InputJsonValue,
      syncError: null,
    };

    if (existing?.provider === X_EXPRESS_PROVIDER) {
      return db.shipment.update({
        where: { id: existing.id },
        data: {
          ...data,
          events: {
            create: {
              status: "CREATED",
              providerStatusCode: result.providerStatusCode ?? null,
              message: "X Express nalog kreiran",
              raw: result.raw as Prisma.InputJsonValue,
            },
          },
        },
      });
    }

    return db.shipment.create({
      data: {
        orderId: order.id,
        service: "COURIER_SMALL",
        ...data,
        events: {
          create: {
            status: "CREATED",
            providerStatusCode: result.providerStatusCode ?? null,
            message: "X Express nalog kreiran",
            raw: result.raw as Prisma.InputJsonValue,
          },
        },
      },
    });
  } catch (err) {
    const message =
      err instanceof XExpressProviderError || err instanceof XExpressConfigError
        ? err.message
        : err instanceof Error
          ? err.message
          : "X Express nalog nije kreiran.";
    await persistFailedShipment({
      orderId: order.id,
      existingShipmentId:
        existing?.provider === X_EXPRESS_PROVIDER ? existing.id : undefined,
      trackingNo,
      message,
      raw: err instanceof XExpressProviderError ? err.raw : undefined,
    });
    throw err;
  }
}

async function findLocationForOrder(city: string, postalCode: string) {
  const byPostalAndName = await db.courierLocationCode.findFirst({
    where: {
      provider: X_EXPRESS_PROVIDER,
      active: true,
      postalCode,
      OR: [
        { name: { contains: city, mode: "insensitive" } },
        { city: { contains: city, mode: "insensitive" } },
        { settlement: { contains: city, mode: "insensitive" } },
      ],
    },
    orderBy: { updatedAt: "desc" },
  });
  if (byPostalAndName) return byPostalAndName;

  return db.courierLocationCode.findFirst({
    where: {
      provider: X_EXPRESS_PROVIDER,
      active: true,
      postalCode,
    },
    orderBy: { updatedAt: "desc" },
  });
}

async function persistFailedShipment(args: {
  orderId: string;
  existingShipmentId?: string;
  trackingNo: string;
  message: string;
  raw?: unknown;
}) {
  const event = {
    status: "FAILED" as const,
    message: `X Express greška: ${args.message}`,
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
      provider: X_EXPRESS_PROVIDER,
      trackingNo: args.trackingNo,
      status: "FAILED",
      syncError: args.message,
      events: { create: event },
    },
  });
}
