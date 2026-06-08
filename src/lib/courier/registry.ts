import "server-only";

import {
  Prisma,
  type OrderStatus,
  type ShipmentService,
  type ShipmentStatus,
} from "@prisma/client";
import { db } from "@/lib/db";
import { X_EXPRESS_PROVIDER } from "@/lib/x-express/config";
import { createXExpressShipmentForOrder } from "@/lib/x-express/shipments";
import { bulkyAdapter } from "./bulky";
import { smallParcelAdapter } from "./small-parcel";
import {
  CourierConfigError,
  type CourierAdapter,
  type CourierWebhookEvent,
} from "./types";
import { SHIPMENT_STATUS_LABEL } from "./status";

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

interface RouteInput {
  shippingMethod: "KURIR" | "KAMION";
  items: { withAssembly: boolean }[];
}

/**
 * Auto-route per spec §4C-2: if any item is bulky → bulky service.
 *
 * Heuristic in v1 (no per-product bulky flag yet): KAMION shipping method
 * OR any item that ships with assembly is treated as bulky.
 */
export function routeService(order: RouteInput): ShipmentService {
  if (order.shippingMethod === "KAMION") return "COURIER_BULKY";
  if (order.items.some((i) => i.withAssembly)) return "COURIER_BULKY";
  return "COURIER_SMALL";
}

/**
 * Create a waybill at the provider and persist the `Shipment` + initial
 * `ShipmentEvent`. Idempotent on `orderId`: an existing CREATED/PICKED_UP
 * shipment is returned unchanged.
 */
export async function createShipmentForOrder(orderId: string) {
  const order = await db.order.findUnique({
    where: { id: orderId },
    include: {
      items: { select: { withAssembly: true } },
      shipments: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  if (!order) throw new Error(`Order ${orderId} ne postoji.`);

  const existing = order.shipments[0];
  if (existing && existing.status !== "FAILED") return existing;

  const service = routeService({
    shippingMethod: order.shippingMethod,
    items: order.items,
  });
  if (service === "COURIER_SMALL") {
    return createXExpressShipmentForOrder(order.id);
  }

  const adapter = getAdapter(service);

  const cashOnDelivery =
    order.paymentMethod === "POUZECE_GOTOVINA" ||
    order.paymentMethod === "POUZECE_KARTICA";

  const result = await adapter.createWaybill({
    orderNumber: order.number,
    total: Number(order.total),
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
    packageCount: order.items.length,
  });

  return db.shipment.create({
    data: {
      orderId: order.id,
      service,
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
        provider: shipment.provider ?? (service === "COURIER_SMALL" ? X_EXPRESS_PROVIDER : undefined),
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

    if (newOrderStatus) {
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
  });

  return {
    shipmentId: shipment.id,
    orderId: shipment.orderId,
    status: event.status,
    customerEmail: shipment.order.user?.email ?? shipment.order.guestEmail ?? null,
    customerPhone: shipment.order.user?.phone ?? shipment.order.shipPhone ?? null,
    eventCreated,
  };
}

export { CourierConfigError };
