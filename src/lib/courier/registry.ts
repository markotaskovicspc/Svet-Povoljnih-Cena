import "server-only";

import {
  Prisma,
  type OrderStatus,
  type ShipmentPurpose,
  type ShipmentService,
  type ShipmentStatus,
} from "@prisma/client";
import { db } from "@/lib/db";
import { X_EXPRESS_PROVIDER } from "@/lib/x-express/config";
import { createXExpressShipmentForOrder } from "@/lib/x-express/shipments";
import { syncXExpressShipmentById } from "@/lib/x-express/sync";
import {
  MYGLS_PROVIDER,
  createMyGlsShipmentForOrder,
  syncMyGlsShipmentById,
} from "@/lib/mygls";
import {
  assertSupplierPickupConfirmed,
  releaseOrderSupplierReservations,
} from "@/lib/rabalux/fulfillment";
import { bulkyAdapter } from "./bulky";
import { smallParcelAdapter } from "./small-parcel";
import {
  CourierConfigError,
  type CourierAdapter,
  type CourierWebhookEvent,
} from "./types";
import { SHIPMENT_STATUS_LABEL } from "./status";
import { routeService } from "./routing";
import { getSelectedSmallParcelProvider } from "./provider-selection";
import {
  derivePhysicalPackages,
  type PhysicalPackage,
} from "./packages";

/**
 * Phase 4C — Routing + side-effects.
 *
 *   - `routeService` decides COURIER_SMALL vs COURIER_BULKY for an order.
 *   - `getAdapter` returns the registered adapter for a service.
 *   - `createShipmentForOrder` creates a waybill at the provider, persists
 *     the `Shipment` row, and emits the initial `ShipmentEvent`.
 *   - `applyShipmentEvent` is called from the per-service webhook route to
 *     append a `ShipmentEvent`, advance the parent `Order` status, and
 *     trigger the customer notification.
 */

const ADAPTERS: Record<ShipmentService, CourierAdapter> = {
  COURIER_SMALL: smallParcelAdapter,
  COURIER_BULKY: bulkyAdapter,
};

export function getAdapter(service: ShipmentService): CourierAdapter {
  return ADAPTERS[service];
}

/** Slug used in the webhook URL: `/api/courier/{slug}/webhook`. */
export const SERVICE_SLUG: Record<ShipmentService, string> = {
  COURIER_SMALL: "small",
  COURIER_BULKY: "bulky",
};

export function adapterFromSlug(slug: string): CourierAdapter | null {
  if (slug === "small") return ADAPTERS.COURIER_SMALL;
  if (slug === "bulky") return ADAPTERS.COURIER_BULKY;
  return null;
}

/**
 * Create a waybill at the provider and persist the `Shipment` + initial
 * `ShipmentEvent`. Idempotent on `orderId`: an existing CREATED/PICKED_UP
 * shipment is returned unchanged.
 */
export async function createShipmentForOrder(
  orderId: string,
  options: {
    packageCount?: number;
    packages?: readonly PhysicalPackage[];
    pickupDate?: Date;
    purpose?: ShipmentPurpose;
    reclamationId?: string;
  } = {},
) {
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
    throw new CourierConfigError("Reklamacija za kurirski nalog nije pronađena.");
  }
  const order = await db.order.findUnique({
    where: { id: orderId },
    include: {
      items: {
        select: {
          id: true,
          name: true,
          withAssembly: true,
          qty: true,
          product: {
            select: {
              packQty: true,
              packWidthCm: true,
              packDepthCm: true,
              packHeightCm: true,
              packGrossWeightKg: true,
              widthCm: true,
              depthCm: true,
              heightCm: true,
              grossWeightKg: true,
              weightKg: true,
            },
          },
        },
      },
      pickupBatchLines: {
        where: { batch: { status: { in: ["DRAFT", "BOOKED"] } } },
        orderBy: { packageNo: "asc" },
        take: 1,
        select: {
          batch: {
            select: { pickupDate: true, provider: true },
          },
        },
      },
      shipments: {
        where: { purpose, reclamationId: reclamation?.id ?? null },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });
  if (!order) throw new Error(`Order ${orderId} ne postoji.`);

  const existing = order.shipments[0];
  if (existing && existing.status !== "FAILED") return existing;
  if (purpose === "ORDER_DELIVERY") {
    await assertSupplierPickupConfirmed(order.id);
  }

  const shipmentItems = reclamation
    ? order.items
        .filter((item) => item.id === reclamation.orderItemId)
        .map((item) => ({ ...item, qty: reclamation.quantity }))
    : order.items;
  if (!shipmentItems.length) {
    throw new CourierConfigError("Stavka reklamacije nije pronađena u porudžbini.");
  }

  const service = routeService({
    shippingMethod: order.shippingMethod,
    items: shipmentItems.map((item) => ({
      withAssembly: item.withAssembly,
      qty: item.qty,
      packQty: item.product?.packQty,
      packWidthCm: Number(item.product?.packWidthCm ?? 0),
      packDepthCm: Number(item.product?.packDepthCm ?? 0),
      packHeightCm: Number(item.product?.packHeightCm ?? 0),
      packGrossWeightKg: Number(item.product?.packGrossWeightKg ?? 0),
    })),
  });
  if (service === "COURIER_SMALL") {
    const selectedProvider = await getSelectedSmallParcelProvider();
    const packages =
      options.packages ??
      derivePhysicalPackages(
        shipmentItems.map((item) => ({
          id: item.id,
          name: item.name,
          qty: item.qty,
          product: item.product,
        })),
      );
    const derivedPackageCount = shipmentItems.reduce(
      (sum, item) =>
        sum +
        Math.max(
          1,
          Math.ceil(item.qty / Math.max(item.product?.packQty ?? 1, 1)),
        ),
      0,
    );
    return selectedProvider === "MYGLS"
      ? createMyGlsShipmentForOrder(order.id, {
          purpose,
          reclamationId: reclamation?.id,
          pickupDate:
            options.pickupDate ??
            (order.pickupBatchLines[0]?.batch.provider === MYGLS_PROVIDER ||
            order.pickupBatchLines[0]?.batch.provider == null
              ? order.pickupBatchLines[0]?.batch.pickupDate ?? undefined
              : undefined),
          packages,
        })
      : createXExpressShipmentForOrder(order.id, {
          packageCount: options.packageCount ?? derivedPackageCount,
          purpose,
          reclamationId: reclamation?.id,
        });
  }

  if (purpose === "RECLAMATION_RETURN") {
    throw new CourierConfigError(
      "Povrat kabaste robe zahteva ručni kamionski nalog; automatski obrnuti smer nije podržan.",
    );
  }

  const adapter = getAdapter(service);

  const cashOnDelivery =
    purpose === "ORDER_DELIVERY" &&
    order.paymentMethod === "POUZECE_GOTOVINA" ||
    (purpose === "ORDER_DELIVERY" && order.paymentMethod === "POUZECE_KARTICA");

  const result = await adapter.createWaybill({
    orderNumber:
      purpose === "ORDER_DELIVERY"
        ? order.number
        : `${order.number}-ZAMENA-${reclamation?.id.slice(-6)}`,
    total: purpose === "ORDER_DELIVERY" ? Number(order.total) : 0,
    cashOnDelivery,
    recipient: {
      firstName: order.shipFirstName,
      lastName: order.shipLastName,
      phone: order.shipPhone,
      street: order.shipStreet,
      city: order.shipCity,
      postalCode: order.shipPostalCode,
      country: order.shipCountry,
      companyName: order.shipCompanyName,
    },
    notes: order.notes,
    packageCount: shipmentItems.reduce(
      (sum, item) =>
        sum + Math.max(1, Math.ceil(item.qty / Math.max(item.product?.packQty ?? 1, 1))),
      0,
    ),
  });

  return db.shipment.create({
    data: {
      orderId: order.id,
      service,
      purpose,
      reclamationId: reclamation?.id ?? null,
      reclamationQty: reclamation?.quantity ?? null,
      warehouseId: reclamation?.warehouseId ?? null,
      trackingNo: result.trackingNo,
      labelUrl: result.labelUrl,
      status: "CREATED",
      events: {
        create: {
          status: "CREATED",
          message: SHIPMENT_STATUS_LABEL.CREATED,
        },
      },
    },
  });
}

/**
 * Map a shipment status to the canonical `OrderStatus` we surface in the
 * customer timeline. Returning `null` means "no order-level transition".
 */
function orderStatusFor(status: ShipmentStatus): OrderStatus | null {
  switch (status) {
    case "PICKED_UP":
      return "SPREMNO_ZA_ISPORUKU";
    case "IN_TRANSIT":
    case "OUT_FOR_DELIVERY":
      return "U_ISPORUCI";
    case "DELIVERED":
      return "ISPORUCENO";
    case "RETURNED":
      return "VRACENO";
    case "FAILED":
    case "CREATED":
      return null;
  }
}

export interface ApplyEventResult {
  shipmentId: string;
  orderId: string;
  status: ShipmentStatus;
  customerEmail: string | null;
  customerPhone: string | null;
  eventCreated: boolean;
}

/**
 * Persist a verified webhook event. Idempotent on (trackingNo, status).
 * Side-effects:
 *   1. Append `ShipmentEvent`.
 *   2. Update `Shipment.status` (+ shippedAt / deliveredAt).
 *   3. Emit `OrderStatusEvent` and update parent `Order.status`.
 *   4. Return notification handles for the caller (email / SMS / Viber
 *      delivery is wired in 4D / 4E).
 */
export async function applyShipmentEvent(
  service: ShipmentService,
  event: CourierWebhookEvent,
): Promise<ApplyEventResult | null> {
  const shipment = await db.shipment.findFirst({
    where: { trackingNo: event.trackingNo, service },
    include: {
      order: {
        select: {
          id: true,
          guestEmail: true,
          shipPhone: true,
          user: { select: { email: true, phone: true } },
        },
      },
    },
  });
  if (!shipment) return null;

  const occurredAt = event.occurredAt ?? new Date();
  const newOrderStatus = orderStatusFor(event.status);
  const message = event.message ?? SHIPMENT_STATUS_LABEL[event.status];
  const selectedSmallProvider =
    service === "COURIER_SMALL"
      ? await getSelectedSmallParcelProvider()
      : null;
  let eventCreated = false;

  await db.$transaction(async (tx) => {
    if (event.providerEventId) {
      const duplicate = await tx.shipmentEvent.findUnique({
        where: { providerEventId: event.providerEventId },
        select: { id: true },
      });
      if (duplicate) return;
    } else {
      const duplicate = await tx.shipmentEvent.findFirst({
        where: {
          shipmentId: shipment.id,
          status: event.status,
          occurredAt,
        },
        select: { id: true },
      });
      if (duplicate) return;
    }

    await tx.shipmentEvent.create({
      data: {
        shipmentId: shipment.id,
        status: event.status,
        providerStatusCode: event.providerStatusCode ?? null,
        providerEventId: event.providerEventId ?? null,
        message,
        raw: event.raw as Prisma.InputJsonValue | undefined,
        occurredAt,
      },
    });
    eventCreated = true;

    await tx.shipment.update({
      where: { id: shipment.id },
      data: {
        provider:
          shipment.provider ??
          (service === "COURIER_SMALL"
            ? selectedSmallProvider === "MYGLS"
              ? MYGLS_PROVIDER
              : X_EXPRESS_PROVIDER
            : undefined),
        status: event.status,
        providerStatusCode: event.providerStatusCode ?? shipment.providerStatusCode,
        lastStatusSyncAt: new Date(),
        syncError: null,
        shippedAt:
          shipment.shippedAt ?? (event.status === "PICKED_UP" ? occurredAt : undefined),
        deliveredAt:
          event.status === "DELIVERED" ? occurredAt : shipment.deliveredAt ?? undefined,
      },
    });

    if (shipment.purpose === "ORDER_DELIVERY" && newOrderStatus) {
      await tx.order.update({
        where: { id: shipment.orderId },
        data: { status: newOrderStatus },
      });
      await tx.orderStatusEvent.create({
        data: {
          orderId: shipment.orderId,
          status: newOrderStatus,
          note: message,
        },
      });
    }
    if (
      shipment.purpose === "ORDER_DELIVERY" &&
      ["PICKED_UP", "IN_TRANSIT", "OUT_FOR_DELIVERY", "DELIVERED"].includes(
        event.status,
      )
    ) {
      await releaseOrderSupplierReservations(tx, shipment.orderId, {
        cancelled: false,
      });
    }
    if (
      shipment.purpose === "RECLAMATION_REPLACEMENT" &&
      shipment.reclamationId &&
      event.status === "DELIVERED"
    ) {
      const resolved = await tx.reclamation.updateMany({
        where: {
          id: shipment.reclamationId,
          status: { not: "RESENO" },
        },
        data: {
          status: "RESENO",
          resolvedAt: occurredAt,
          warehouseStatus: "HANDED_OVER",
        },
      });
      if (resolved.count > 0) {
        await tx.reclamationStatusEvent.create({
          data: {
            reclamationId: shipment.reclamationId,
            status: "RESENO",
            note: `Zamena/deo potvrđeno isporučen (${shipment.trackingNo ?? shipment.id}).`,
          },
        });
      }
    }
  });

  if (
    eventCreated &&
    shipment.provider === MYGLS_PROVIDER &&
    ["PICKED_UP", "IN_TRANSIT", "OUT_FOR_DELIVERY", "DELIVERED"].includes(
      event.status,
    )
  ) {
    await markCompletedMyGlsPickupBatches(shipment.orderId);
  }

  return {
    shipmentId: shipment.id,
    orderId: shipment.orderId,
    status: event.status,
    customerEmail: shipment.order.user?.email ?? shipment.order.guestEmail ?? null,
    customerPhone: shipment.order.user?.phone ?? shipment.order.shipPhone ?? null,
    eventCreated,
  };
}

async function markCompletedMyGlsPickupBatches(orderId: string) {
  const batches = await db.pickupBatch.findMany({
    where: {
      provider: MYGLS_PROVIDER,
      status: "BOOKED",
      lines: { some: { orderId } },
    },
    select: {
      id: true,
      lines: { select: { orderId: true } },
    },
  });
  const pickedUpStatuses: ShipmentStatus[] = [
    "PICKED_UP",
    "IN_TRANSIT",
    "OUT_FOR_DELIVERY",
    "DELIVERED",
  ];
  for (const batch of batches) {
    const orderIds = Array.from(new Set(batch.lines.map((line) => line.orderId)));
    const shipments = await db.shipment.findMany({
      where: {
        orderId: { in: orderIds },
        provider: MYGLS_PROVIDER,
        purpose: "ORDER_DELIVERY",
        status: { in: pickedUpStatuses },
      },
      select: { orderId: true },
    });
    const pickedUpOrderIds = new Set(shipments.map((item) => item.orderId));
    if (orderIds.every((id) => pickedUpOrderIds.has(id))) {
      await db.pickupBatch.updateMany({
        where: { id: batch.id, status: "BOOKED" },
        data: { status: "PICKED_UP" },
      });
    }
  }
}

export async function syncCourierShipmentById(shipmentId: string) {
  const shipment = await db.shipment.findUnique({
    where: { id: shipmentId },
    select: { provider: true },
  });
  if (!shipment?.provider) {
    throw new Error("Pošiljka nema podešenog kurira.");
  }
  if (shipment.provider === MYGLS_PROVIDER) return syncMyGlsShipmentById(shipmentId);
  if (shipment.provider === X_EXPRESS_PROVIDER) return syncXExpressShipmentById(shipmentId);
  throw new Error(`Status sync nije podržan za kurira ${shipment.provider}.`);
}

export { CourierConfigError };
