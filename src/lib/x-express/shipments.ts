import "server-only";
import { courierAddressParts } from "@/lib/address/house-number";
import { requireReturnPickupCoordinates, type XExpressPickupCoordinates, type XExpressReturnDestination } from "./return";

import { randomUUID } from "node:crypto";
import {
  Prisma,
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
  normalizeXExpressStreetNumber,
} from "./payload";
import { buildXExpressLabelData } from "./labels";
import { buildXExpressArticleLabels } from "./article-labels";
import {
  normalizeOrderItemIds,
  readShipmentAssignment,
  sameShipmentAssignment,
  withShipmentAssignment,
} from "@/lib/courier/shipment-assignment";
import type { XExpressCreateOrderPayload } from "./types";
import { isXExpressAnnouncementPaymentReady } from "./payment";
import { assertFulfillmentPaymentReady } from "@/lib/payments/fulfillment-readiness";
import type { XExpressConfig } from "./config";
import { requireRabaluxPickupForProvider } from "@/lib/rabalux/pickup";
import { BackgroundJobDeferredError } from "@/lib/background-job-deferral";
import { rabaluxCourierAvailableAt } from "@/lib/rabalux/dispatch-policy";

export async function createXExpressShipmentForOrder(
  orderId: string,
  options: {
    returnPickupCoordinates?: XExpressPickupCoordinates;
    packageCount?: number;
    packages?: readonly PhysicalPackage[];
    purpose?: ShipmentPurpose;
    reclamationId?: string;
    orderItemIds?: string[];
    codAmount?: number;
    packageMasses?: number[];
    supplierFulfillmentId?: string;
    assignmentKey?: string;
    pickupOverride?: XExpressConfig["pickup"];
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
          sku: true,
          qty: true,
          withAssembly: true,
          product: {
            select: {
              barcode: true,
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
  const codAmount = purpose !== "ORDER_DELIVERY" ? 0 :
    Number.isFinite(options.codAmount) && Number(options.codAmount) >= 0
      ? Number(options.codAmount)
      : Number(order.total);
  const existing = order.shipments.find(
    (shipment) =>
      shipment.provider === X_EXPRESS_PROVIDER &&
      (readShipmentAssignment(shipment.rawCreateResponse)?.supplierFulfillmentId ?? null) ===
        (options.supplierFulfillmentId ?? null) &&
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
  if (
    existing &&
    existing.provider === X_EXPRESS_PROVIDER &&
    existing.status !== "FAILED"
  ) {
    return existing;
  }

  const cfg = requireXExpressShipmentConfig(
    purpose === "ORDER_DELIVERY" &&
      isXExpressCashOnDelivery(order.paymentMethod) &&
      codAmount > 0,
    options.pickupOverride,
  );

  const reverse = purpose === "RECLAMATION_RETURN";
  const returnPickupCoordinates = reverse
    ? requireReturnPickupCoordinates(options.returnPickupCoordinates)
    : undefined;
  const returnDestination = reverse
    ? await resolveXExpressReturnDestination(reclamation!.warehouseId, cfg)
    : undefined;

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
      houseNumber: order.shipHouseNumber,
      officialStreetName: officialStreet?.name,
    });
    if (reverse) {
      const address = courierAddressParts(order.shipStreet, order.shipHouseNumber)!;
      addressCheckPayload.StreetNumber = normalizeXExpressStreetNumber(address.originalHouseNumber);
    }
    const addressCheck = await client.checkAddress(addressCheckPayload);
    const payload = buildXExpressCreateOrderPayload({
      cfg,
      reference: shipmentId,
      trackingCodes: allocated,
      purpose,
      returnPickupCoordinates,
      returnDestination,
      order: { ...order, total: codAmount, items: shipmentItems },
      townId,
      officialStreetName: officialStreet?.name,
      packageMasses:
        options.packages?.map((pkg) => Number(pkg.weightKg ?? 0)) ??
        options.packageMasses,
      packageContents: options.packages?.map((pkg) => pkg.content ?? ""),
    });
    // The route on the label is the destination depot, not the customer's
    // pickup depot. Check both endpoints before saving a usable return label.
    const destinationCheck = returnDestination
      ? await client.checkAddress({
          ...payload.Waypoints.find((waypoint) => waypoint.WaypointType === "DELIVERY")!.Address,
        })
      : addressCheck;
    const labelUrl = `/api/admin/shipments/${shipmentId}/label`;
    const rawCreateResponse = withShipmentAssignment({
      addressCheck: destinationCheck.raw,
      ...(reverse ? { pickupAddressCheck: addressCheck.raw } : {}),
      createOrderPayload: payload,
      xExpressAnnouncement: {
        state: "PREPARED",
        preparedAt: new Date().toISOString(),
      },
      reference: shipmentId,
      packages: payload.Packages,
      articleLabels: buildXExpressArticleLabels({
        codes: allocated, packages: options.packages, items: shipmentItems, purpose,
      }),
      labelData: buildXExpressLabelData({
        payload,
        pickupTown: reverse ? { name: location?.name ?? order.shipCity, postalCode: location?.postalCode ?? order.shipPostalCode } : pickupTown,
        deliveryCity: returnDestination?.city ?? location?.name ?? order.shipCity,
        deliveryPostalCode: returnDestination?.postalCode ?? location?.postalCode ?? order.shipPostalCode,
      }),
    }, {
      orderItemIds: assignmentOrderItemIds,
      codAmount,
      supplierFulfillmentId: options.supplierFulfillmentId,
      assignmentKey: options.assignmentKey,
    });
    const data = {
      provider: X_EXPRESS_PROVIDER,
      purpose,
      reclamationId: reclamation?.id ?? null,
      reclamationQty: reclamation?.quantity ?? null,
      warehouseId: reclamation?.warehouseId ?? null,
      providerOrderId: null,
      providerShipmentId: null,
      trackingNo,
      packageCount,
      labelUrl,
      status: "CREATED" as const,
      providerStatusCode: "LOCAL_PREPARED",
      providerParcelNumbers: allocated as Prisma.InputJsonValue,
      providerRouteCode: destinationCheck.area,
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
              message:
                "X Express adresnica pripremljena; pošiljka još nije poslata kuriru",
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
            message:
              "X Express adresnica pripremljena; pošiljka još nije poslata kuriru",
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
      supplierFulfillmentId: options.supplierFulfillmentId,
      assignmentKey: options.assignmentKey,
    });
    throw err;
  }
}

export async function announceXExpressShipment(shipmentId: string) {
  const existing = await db.shipment.findUnique({
    where: { id: shipmentId },
    include: {
      order: {
        select: {
          number: true,
          createdAt: true,
          paymentMethod: true,
          payments: { select: { status: true } },
        },
      },
    },
  });
  if (!existing || existing.provider !== X_EXPRESS_PROVIDER) {
    throw new XExpressConfigError("Pripremljena X Express pošiljka nije pronađena.");
  }
  if (existing.providerShipmentId && existing.status !== "FAILED") {
    return existing;
  }
  if (readShipmentAssignment(existing.rawCreateResponse)?.supplierFulfillmentId) {
    const availableAt = rabaluxCourierAvailableAt(existing.order.createdAt);
    if (Date.now() < availableAt.getTime()) {
      throw new BackgroundJobDeferredError(availableAt);
    }
  }
  if (existing.status === "FAILED") {
    throw new XExpressConfigError(
      "Neuspešna X Express priprema nema važeću adresnicu za slanje.",
    );
  }
  const payload = readPreparedCreateOrderPayload(existing.rawCreateResponse);
  if (!payload) {
    throw new XExpressConfigError(
      "X Express adresnica nema sačuvan originalni API zahtev za slanje.",
    );
  }
  if (
    !isXExpressAnnouncementPaymentReady({
      purpose: existing.purpose,
      paymentMethod: existing.order.paymentMethod,
      paymentStatuses: existing.order.payments.map((payment) => payment.status),
    })
  ) {
    throw new XExpressConfigError(
      `Porudžbina ${existing.order.number} ne može biti poslata X Express-u dok plaćanje nije potvrđeno.`,
    );
  }

  const claimed = await db.shipment.updateMany({
    where: {
      id: shipmentId,
      provider: X_EXPRESS_PROVIDER,
      providerShipmentId: null,
      status: "CREATED",
      providerStatusCode: {
        in: ["LOCAL_PREPARED", "LOCAL_ANNOUNCEMENT_FAILED"],
      },
    },
    data: { providerStatusCode: "LOCAL_ANNOUNCING", syncError: null },
  });
  if (!claimed.count) {
    const current = await db.shipment.findUnique({ where: { id: shipmentId } });
    if (current?.providerShipmentId && current.status !== "FAILED") return current;
    throw new XExpressConfigError(
      "X Express pošiljku trenutno šalje drugi administrator. Osvežite stranicu.",
    );
  }

  try {
    const assignment = readShipmentAssignment(existing.rawCreateResponse);
    const supplierPickup = assignment?.supplierFulfillmentId
      ? requireRabaluxPickupForProvider("X_EXPRESS")
      : null;
    const cfg = requireXExpressShipmentConfig(
      Boolean(payload.Options?.length),
      supplierPickup?.provider === "X_EXPRESS" ? supplierPickup.pickup : undefined,
    );
    const providerResult = await new XExpressClient(cfg).createOrder(payload);
    const raw = jsonRecord(existing.rawCreateResponse);
    const announcedAt = new Date().toISOString();
    return await db.shipment.update({
      where: { id: shipmentId },
      data: {
        providerOrderId: providerResult.providerOrderId ?? null,
        providerShipmentId: providerResult.providerShipmentId,
        trackingNo: providerResult.trackingNo,
        providerStatusCode: providerResult.providerStatusCode ?? null,
        syncError: null,
        rawCreateResponse: {
          ...raw,
          createOrder: providerResult.raw,
          xExpressAnnouncement: {
            state: "ANNOUNCED",
            announcedAt,
            requestGuid: providerResult.requestGuid,
          },
        } as Prisma.InputJsonValue,
        events: {
          create: {
            status: "CREATED",
            message: "X Express je prihvatio najavu pošiljke",
            raw: providerResult.raw as Prisma.InputJsonValue,
          },
        },
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Slanje X Express pošiljke nije uspelo.";
    await db.shipment.updateMany({
      where: {
        id: shipmentId,
        provider: X_EXPRESS_PROVIDER,
        providerShipmentId: null,
        providerStatusCode: "LOCAL_ANNOUNCING",
      },
      data: {
        providerStatusCode: "LOCAL_ANNOUNCEMENT_FAILED",
        syncError: message,
      },
    });
    await db.shipmentEvent.create({
      data: {
        shipmentId,
        status: "CREATED",
        message: `X Express najava nije poslata: ${message}`,
        raw:
          error instanceof XExpressProviderError && error.raw != null
            ? (error.raw as Prisma.InputJsonValue)
            : undefined,
      },
    });
    throw error;
  }
}

function readPreparedCreateOrderPayload(
  raw: Prisma.JsonValue | null,
): XExpressCreateOrderPayload | null {
  const value = jsonRecord(raw).createOrderPayload;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record.ContractCode !== "string" ||
    typeof record.Reference !== "string" ||
    !record.Sender ||
    typeof record.Sender !== "object" ||
    !record.Recipient ||
    typeof record.Recipient !== "object" ||
    !Array.isArray(record.Waypoints) ||
    !Array.isArray(record.Packages) ||
    !record.Packages.length ||
    record.Packages.some((pkg) => {
      if (!pkg || typeof pkg !== "object" || Array.isArray(pkg)) return true;
      const item = pkg as Record<string, unknown>;
      return (
        typeof item.Code !== "string" ||
        !/^[A-Z]{3}\d{10}$/.test(item.Code) ||
        typeof item.Mass !== "number" ||
        typeof item.Content !== "string"
      );
    })
  ) {
    return null;
  }
  return value as unknown as XExpressCreateOrderPayload;
}

function jsonRecord(value: Prisma.JsonValue | null) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {} as Record<string, Prisma.JsonValue>;
  }
  return value as Record<string, Prisma.JsonValue>;
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

/** Return destination follows the selected warehouse, never an unrelated pickup config. */
async function resolveXExpressReturnDestination(
  warehouseId: string | null,
  cfg: XExpressConfig,
): Promise<XExpressReturnDestination> {
  const warehouse = warehouseId ? await db.warehouse.findFirst({
    where: { id: warehouseId, active: true },
    select: { name: true, address: true, city: true, phone: true, email: true },
  }) : null;
  const street = warehouse?.address
    ? courierAddressParts(warehouse.address.split(",")[0]!.trim()) : null;
  if (!warehouse?.city || !street) {
    throw new XExpressConfigError("Magacin za povrat mora imati grad, ulicu i kućni broj. Dopunite adresu magacina.");
  }
  const towns = await db.xExpressTown.findMany({
    where: { active: true, name: { equals: warehouse.city.trim(), mode: "insensitive" } },
    select: { id: true, name: true, postalCode: true },
    take: 2,
  });
  if (towns.length !== 1) {
    throw new XExpressConfigError("Grad magacina za povrat nije jednoznačno pronađen u X Express šifarniku. Proverite grad magacina.");
  }
  const town = towns[0]!;
  return {
    name: warehouse.name, townId: town.id, city: town.name,
    postalCode: town.postalCode ?? "",
    streetName: street.street, streetNumber: street.originalHouseNumber,
    contactName: warehouse.name,
    phone: warehouse.phone || cfg.pickup.contactPhone,
    email: warehouse.email || cfg.pickup.contactEmail,
  };
}
