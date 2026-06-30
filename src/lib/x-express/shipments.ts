import "server-only";

import { randomUUID } from "node:crypto";
import { Prisma, type PaymentStatus } from "@prisma/client";
import { db } from "@/lib/db";
import {
  X_EXPRESS_PROVIDER,
  XExpressConfigError,
  XExpressProviderError,
  requireXExpressEnabled,
} from "./config";
import { allocateXExpressTrackingCode } from "./code";
import { isXExpressCashOnDelivery } from "./payload";

const PAID_STATUSES: PaymentStatus[] = ["AUTHORIZED", "PAID"];

export async function createXExpressShipmentForOrder(
  orderId: string,
  options: { packageCount?: number } = {},
) {
  const cfg = requireXExpressEnabled();
  const packageCount = Math.max(1, Math.min(99, Math.trunc(options.packageCount ?? 1)));
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

  const allocated =
    existing?.provider === X_EXPRESS_PROVIDER && existing.trackingNo
      ? [existing.trackingNo]
      : await db.$transaction(async (tx) => {
          const codes: string[] = [];
          for (let i = 0; i < packageCount; i += 1) {
            codes.push((await allocateXExpressTrackingCode(tx)).trackingNo);
          }
          return codes;
        });
  const trackingNo = allocated[0]!;
  const location = await findLocationForOrder(
    order.shipCity,
    order.shipPostalCode,
    order.shipXExpressTownId,
  );
  const shipmentId =
    existing?.provider === X_EXPRESS_PROVIDER ? existing.id : randomUUID();
  const labelUrl = `/api/admin/shipments/${shipmentId}/label`;
  const rawCreateResponse = {
    localLabelOnly: true,
    docsRequired: true,
    reason:
      "X Express final order-submit/check-address payload was not implemented because the exact portal docs were not provided.",
    contractCode: cfg.contractCode,
    referenceId: order.number,
    townId: order.shipXExpressTownId ?? location?.code ?? null,
    packageCount,
    trackingCodes: allocated,
  };

  try {
    const data = {
      provider: X_EXPRESS_PROVIDER,
      providerOrderId: null,
      providerShipmentId: null,
      trackingNo,
      packageCount,
      labelUrl,
      status: "CREATED" as const,
      providerStatusCode: null,
      providerParcelNumbers: allocated as Prisma.InputJsonValue,
      providerRouteCode: null,
      providerRouteName: null,
      rawCreateResponse: rawCreateResponse as Prisma.InputJsonValue,
      syncError:
        "Lokalne X Express etikete su kreirane. Finalna najava API-jem čeka tačnu Shipment API dokumentaciju iz portala.",
    };

    if (existing?.provider === X_EXPRESS_PROVIDER) {
      return db.shipment.update({
        where: { id: existing.id },
        data: {
          ...data,
          events: {
            create: {
              status: "CREATED",
              message: "X Express lokalne etikete kreirane",
              raw: rawCreateResponse as Prisma.InputJsonValue,
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
            message: "X Express lokalne etikete kreirane",
            raw: rawCreateResponse as Prisma.InputJsonValue,
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

async function findLocationForOrder(
  city: string,
  postalCode: string,
  townId?: number | null,
) {
  if (townId) {
    const town = await db.xExpressTown.findFirst({
      where: { id: townId, active: true },
      select: { id: true, name: true, postalCode: true, municipalityId: true, raw: true },
    });
    if (town) {
      return {
        code: String(town.id),
        name: town.name,
        postalCode: town.postalCode,
        municipality: town.municipalityId ? String(town.municipalityId) : null,
        city: town.name,
        settlement: town.name,
        raw: town.raw,
      };
    }
  }

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
