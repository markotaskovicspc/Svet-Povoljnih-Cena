import "server-only";

import { randomUUID } from "node:crypto";
import {
  Prisma,
  type PaymentStatus,
  type ShipmentPurpose,
} from "@prisma/client";
import { db } from "@/lib/db";
import type { PhysicalPackage } from "@/lib/courier/packages";
import {
  X_EXPRESS_PROVIDER,
  XExpressConfigError,
  XExpressProviderError,
  requireXExpressShipmentConfig,
} from "./config";
import { XExpressClient } from "./client";
import { allocateXExpressTrackingCode } from "./code";
import {
  buildXExpressAddressCheckPayload,
  buildXExpressCreateOrderPayload,
  isXExpressCashOnDelivery,
} from "./payload";
import { buildXExpressLabelData } from "./labels";
import {
  normalizeOrderItemIds,
  sameShipmentAssignment,
  withShipmentAssignment,
} from "@/lib/courier/shipment-assignment";

const PAID_STATUSES: PaymentStatus[] = ["AUTHORIZED", "PAID"];

export async function createXExpressShipmentForOrder(
  orderId: string,
  options: {
    packageCount?: number;
    packages?: readonly PhysicalPackage[];
    purpose?: ShipmentPurpose;
    reclamationId?: string;
    orderItemIds?: string[];
    codAmount?: number;
    packageMasses?: number[];
  } = {},
) {
  const packageCount = Math.max(
    1,
    Math.min(
      99,
      Math.trunc(options.packages?.length ?? options.packageCount ?? 1),
    ),
  );
  const purpose = options.purpose ?? "ORDER_DELIVERY";
  if (purpose === "RECLAMATION_RETURN") {
    throw new XExpressConfigError(
      "X Express povrat od kupca zahteva tačne pickup koordinate kupca. Koristite MyGLS ili ručni nalog dok koordinate nisu evidentirane.",
    );
  }
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
    throw new XExpressConfigError("Reklamacija za kurirski nalog nije pronađena.");
  }
  const order = await db.order.findUnique({
    where: { id: orderId },
    include: {
      items: {
        select: {
          id: true,
          name: true,
          qty: true,
          withAssembly: true,
          product: {
            select: {
              packQty: true,
              packGrossWeightKg: true,
              grossWeightKg: true,
              weightKg: true,
            },
          },
        },
      },
      user: { select: { email: true } },
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
    throw new XExpressConfigError("X Express se koristi samo za kurirsku isporuku.");
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
    throw new XExpressConfigError("Stavka reklamacije nije pronađena u porudžbini.");
  }
  if (
    requestedOrderItemIds.length &&
    shipmentItems.length !== requestedOrderItemIds.length
  ) {
    throw new XExpressConfigError(
      "Jedna od izabranih stavki ne pripada ovoj porudžbini.",
    );
  }
  if (shipmentItems.some((item) => item.withAssembly)) {
    throw new XExpressConfigError(
      "Porudžbina ima montažu/kamionsku logiku i ne šalje se kroz X Express.",
    );
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
      shipment.provider === X_EXPRESS_PROVIDER &&
      (!requestedOrderItemIds.length ||
        sameShipmentAssignment(
          shipment.rawCreateResponse,
          assignmentOrderItemIds,
        )),
  );
  if (
    existing &&
    existing.provider === X_EXPRESS_PROVIDER &&
    existing.status !== "FAILED"
  ) {
    return existing;
  }

  if (purpose === "ORDER_DELIVERY" && !isXExpressCashOnDelivery(order.paymentMethod)) {
    const paid = order.payments.some((p) => PAID_STATUSES.includes(p.status));
    if (!paid) {
      throw new XExpressConfigError(
        "Prepaid porudžbina mora imati uspešno/autorizovano plaćanje pre slanja kuriru.",
      );
    }
  }
  const cfg = requireXExpressShipmentConfig(
    purpose === "ORDER_DELIVERY" &&
      isXExpressCashOnDelivery(order.paymentMethod) &&
      codAmount > 0,
  );

  const reusableCodes = readParcelNumbers(existing?.providerParcelNumbers);
  const allocated =
    existing?.provider === X_EXPRESS_PROVIDER &&
    existing.status === "FAILED" &&
    existing.packageCount === packageCount &&
    reusableCodes.length >= packageCount
      ? reusableCodes.slice(0, packageCount)
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
  const officialStreet = order.shipXExpressStreetId
    ? await db.xExpressStreet.findFirst({
        where: {
          id: order.shipXExpressStreetId,
          townId: order.shipXExpressTownId ?? undefined,
          active: true,
          deleted: false,
        },
        select: { name: true },
      })
    : null;
  const pickupTown = cfg.pickup.townId
    ? await db.xExpressTown.findUnique({
        where: { id: cfg.pickup.townId },
        select: { name: true, displayName: true, postalCode: true },
      })
    : null;

  try {
    const townId = order.shipXExpressTownId ?? Number(location?.code);
    if (!Number.isInteger(townId) || townId <= 0) {
      throw new XExpressConfigError("X Express mesto isporuke nije potvrđeno u šifarniku.");
    }
    const client = new XExpressClient(cfg);
    const recipientName =
      order.shipCompanyName || `${order.shipFirstName} ${order.shipLastName}`;
    const addressCheckPayload = buildXExpressAddressCheckPayload({
      recipientName,
      townId,
      street: order.shipStreet,
      officialStreetName: officialStreet?.name,
    });
    const addressCheck = await client.checkAddress(addressCheckPayload);
    const payload = buildXExpressCreateOrderPayload({
      cfg,
      reference: shipmentId,
      trackingCodes: allocated,
      purpose,
      order: { ...order, total: codAmount, items: shipmentItems },
      townId,
      officialStreetName: officialStreet?.name,
      packageMasses:
        options.packages?.map((pkg) => Number(pkg.weightKg ?? 0)) ??
        options.packageMasses,
      packageContents: options.packages?.map((pkg) => pkg.content ?? ""),
    });
    const providerResult = await client.createOrder(payload);
    const labelUrl = providerResult.labelUrl ?? `/api/admin/shipments/${shipmentId}/label`;
    const rawCreateResponse = withShipmentAssignment({
      addressCheck: addressCheck.raw,
      createOrder: providerResult.raw,
      reference: shipmentId,
      packages: payload.Packages,
      labelData: buildXExpressLabelData({
        payload,
        pickupTown,
        deliveryCity: location?.name ?? order.shipCity,
        deliveryPostalCode: location?.postalCode ?? order.shipPostalCode,
      }),
    }, {
      orderItemIds: assignmentOrderItemIds,
      codAmount,
    });
    const data = {
      provider: X_EXPRESS_PROVIDER,
      purpose,
      reclamationId: reclamation?.id ?? null,
      reclamationQty: reclamation?.quantity ?? null,
      warehouseId: reclamation?.warehouseId ?? null,
      providerOrderId: providerResult.providerOrderId ?? null,
      providerShipmentId: providerResult.providerShipmentId ?? null,
      trackingNo: providerResult.trackingNo,
      packageCount,
      labelUrl,
      status: "CREATED" as const,
      providerStatusCode: providerResult.providerStatusCode ?? null,
      providerParcelNumbers: allocated as Prisma.InputJsonValue,
      providerRouteCode: addressCheck.area,
      providerRouteName: null,
      rawCreateResponse: rawCreateResponse as unknown as Prisma.InputJsonValue,
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
              message: "X Express nalog kreiran i adresa potvrđena",
              raw: rawCreateResponse as unknown as Prisma.InputJsonValue,
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
            message: "X Express nalog kreiran i adresa potvrđena",
            raw: rawCreateResponse as unknown as Prisma.InputJsonValue,
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
      trackingCodes: allocated,
      packageCount,
      purpose,
      reclamationId: reclamation?.id,
      reclamationQty: reclamation?.quantity,
      warehouseId: reclamation?.warehouseId,
      message,
      raw: err instanceof XExpressProviderError ? err.raw : undefined,
      orderItemIds: assignmentOrderItemIds,
      codAmount,
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
  trackingCodes: string[];
  packageCount: number;
  purpose: ShipmentPurpose;
  reclamationId?: string;
  reclamationQty?: number;
  warehouseId?: string | null;
  message: string;
  raw?: unknown;
  orderItemIds: string[];
  codAmount: number;
}) {
  const rawCreateResponse = withShipmentAssignment(args.raw, {
    orderItemIds: args.orderItemIds,
    codAmount: args.codAmount,
  });
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
        trackingNo: args.trackingNo,
        packageCount: args.packageCount,
        providerParcelNumbers: args.trackingCodes as Prisma.InputJsonValue,
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
      provider: X_EXPRESS_PROVIDER,
      purpose: args.purpose,
      reclamationId: args.reclamationId ?? null,
      reclamationQty: args.reclamationQty ?? null,
      warehouseId: args.warehouseId ?? null,
      trackingNo: args.trackingNo,
      packageCount: args.packageCount,
      providerParcelNumbers: args.trackingCodes as Prisma.InputJsonValue,
      rawCreateResponse: rawCreateResponse as Prisma.InputJsonValue,
      status: "FAILED",
      syncError: args.message,
      events: { create: event },
    },
  });
}

function readParcelNumbers(value: Prisma.JsonValue | null | undefined) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}
