import "server-only";

import {
  Prisma,
  type OrderStatus,
  type Shipment,
  type ShipmentPurpose,
  type ShipmentService,
  type ShipmentStatus,
} from "@prisma/client";
import { db } from "@/lib/db";
import { enqueueBackgroundJob } from "@/lib/background-jobs";
import { X_EXPRESS_PROVIDER } from "@/lib/x-express/config";
import {
  announceXExpressShipment,
  createXExpressShipmentForOrder,
} from "@/lib/x-express/shipments";
import { syncXExpressShipmentById } from "@/lib/x-express/sync";
import {
  MYGLS_PROVIDER,
  createMyGlsShipmentForOrder,
  preflightMyGlsShipmentForOrder as preflightMyGlsProviderShipmentForOrder,
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
import { resolveCourierProvider, routeService } from "./routing";
import { getSelectedSmallParcelProvider } from "./provider-selection";
import type { SmallParcelProvider } from "@/lib/mygls/config";
import {
  courierPackageCount,
  derivePhysicalPackages,
  type PhysicalPackage,
} from "./packages";
import {
  normalizeOrderItemIds,
  readShipmentAssignment,
  sameShipmentAssignment,
} from "./shipment-assignment";
import { assertFulfillmentPaymentReady } from "@/lib/payments/fulfillment-readiness";
import { requireRabaluxPickupForProvider } from "@/lib/rabalux/pickup";

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
type ShipmentCreationOptions = {
  packageCount?: number;
  packages?: readonly PhysicalPackage[];
  pickupDate?: Date;
  purpose?: ShipmentPurpose;
  reclamationId?: string;
  orderItemIds?: string[];
  provider?: SmallParcelProvider;
  codAmount?: number;
  /** Rabalux dropship group whose items and pickup address must be used. */
  supplierFulfillmentId?: string;
  /** Prepare an X Express label without announcing it to the provider yet. */
  announceXExpress?: boolean;
};

export function createShipmentForOrder(
  orderId: string,
  options: ShipmentCreationOptions = {},
): Promise<Shipment> {
  return processShipmentForOrder(orderId, options, "create") as Promise<Shipment>;
}

/** Validate routing and the exact provider payload without any provider write. */
export async function preflightShipmentForOrder(
  orderId: string,
  options: ShipmentCreationOptions = {},
) {
  await processShipmentForOrder(orderId, options, "preflight");
}

async function processShipmentForOrder(
  orderId: string,
  options: ShipmentCreationOptions,
  mode: "create" | "preflight",
): Promise<Shipment | void> {
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
              unitPackWidthCm: true,
              unitPackDepthCm: true,
              unitPackHeightCm: true,
              widthCm: true,
              depthCm: true,
              heightCm: true,
              grossWeightKg: true,
              weightKg: true,
            },
          },
        },
      },
      shipments: {
        where: { purpose, reclamationId: reclamation?.id ?? null },
        orderBy: { createdAt: "desc" },
      },
      payments: {
        select: { status: true },
        orderBy: { createdAt: "desc" },
      },
    },
  });
  if (!order) throw new Error(`Order ${orderId} ne postoji.`);

  const requestedOrderItemIds = normalizeOrderItemIds(options.orderItemIds);
  const supplierFulfillment = options.supplierFulfillmentId
    ? await db.supplierFulfillment.findFirst({
        where: {
          id: options.supplierFulfillmentId,
          orderId: order.id,
          supplier: { integrationKey: "RABALUX" },
          status: { notIn: ["CANCELLED", "COMPLETED"] },
        },
        select: { id: true, items: { select: { orderItemId: true } } },
      })
    : null;
  if (options.supplierFulfillmentId && !supplierFulfillment) {
    throw new CourierConfigError("Rabalux grupa za ovu porudžbinu nije pronađena.");
  }
  if (supplierFulfillment) {
    const fulfillmentItemIds = normalizeOrderItemIds(
      supplierFulfillment.items.map((item) => item.orderItemId),
    );
    if (
      !requestedOrderItemIds.length ||
      fulfillmentItemIds.length !== requestedOrderItemIds.length ||
      fulfillmentItemIds.some((id) => !requestedOrderItemIds.includes(id))
    ) {
      throw new CourierConfigError(
        "Rabalux pošiljka mora sadržati tačno stavke iz izabrane dobavljačke grupe.",
      );
    }
  }

  assertFulfillmentPaymentReady({
    orderNumber: order.number,
    purpose,
    paymentMethod: order.paymentMethod,
    paymentStatuses: order.payments.map((payment) => payment.status),
  });

  const existing = requestedOrderItemIds.length
    ? null
    : order.shipments.find((shipment) => shipment.status !== "FAILED") ?? null;
  if (existing) return existing;
  if (purpose === "ORDER_DELIVERY" && !supplierFulfillment) {
    await assertSupplierPickupConfirmed(order.id, requestedOrderItemIds);
  }

  const shipmentItems = reclamation
    ? order.items
        .filter((item) => item.id === reclamation.orderItemId)
        .map((item) => ({ ...item, qty: reclamation.quantity }))
    : requestedOrderItemIds.length
      ? order.items.filter((item) => requestedOrderItemIds.includes(item.id))
      : order.items;
  if (!shipmentItems.length) {
    throw new CourierConfigError("Stavka reklamacije nije pronađena u porudžbini.");
  }
  if (
    requestedOrderItemIds.length &&
    shipmentItems.length !== requestedOrderItemIds.length
  ) {
    throw new CourierConfigError(
      "Jedna od izabranih stavki ne pripada ovoj porudžbini.",
    );
  }

  const derivedPackages = derivePhysicalPackages(
    shipmentItems.map((item) => ({
      id: item.id,
      name: item.name,
      qty: item.qty,
      product: item.product,
    })),
  );
  const routeInput = {
    shippingMethod: order.shippingMethod,
    items: derivedPackages.map((pkg) => ({
      withAssembly: false,
      qty: 1,
      packQty: 1,
      packWidthCm: pkg.widthCm,
      packDepthCm: pkg.depthCm,
      packHeightCm: pkg.heightCm,
      packGrossWeightKg: pkg.weightKg,
    })),
  } as const;
  const routing = resolveCourierProvider(routeInput);
  if (routing.kind === "invalid_dimensions") {
    throw new CourierConfigError(
      "Automatski izbor kurira zahteva težinu, širinu, dužinu i visinu svakog paketa u šifarniku artikala.",
    );
  }
  if (options.provider && options.provider !== routing.provider) {
    throw new CourierConfigError(
      `Izabrani kurir ne odgovara težini i dimenzijama paketa; porudžbina pripada ${routing.provider === "MYGLS" ? "MyGLS" : "X Express"} nalogu.`,
    );
  }
  const service = routeService(routeInput);
  const supplierPickup = supplierFulfillment
    ? requireRabaluxPickupForProvider(routing.provider)
    : null;
  if (service === "COURIER_SMALL") {
    const selectedProvider = routing.provider;
    const packages =
      (options.packages
        ? options.packages.filter(
            (pkg) =>
              !requestedOrderItemIds.length ||
              !pkg.orderItemId ||
              requestedOrderItemIds.includes(pkg.orderItemId),
          )
        : null) ??
      derivedPackages;
    const derivedPackageCount = derivedPackages.length;
    if (selectedProvider === "MYGLS") {
      const myGlsOptions = {
        purpose,
        reclamationId: reclamation?.id,
        pickupDate: options.pickupDate,
        packages,
        orderItemIds: requestedOrderItemIds,
        codAmount: options.codAmount,
        supplierFulfillmentId: supplierFulfillment?.id,
        pickupOverride:
          supplierPickup?.provider === "MYGLS" ? supplierPickup.pickup : undefined,
      };
      if (mode === "preflight") {
        await preflightMyGlsProviderShipmentForOrder(order.id, myGlsOptions);
        return;
      }
      return createMyGlsShipmentForOrder(order.id, myGlsOptions);
    }
    if (mode === "preflight") return;
    const shipment = await createXExpressShipmentForOrder(order.id, {
      packageCount: options.packageCount ?? derivedPackageCount,
      packages,
      purpose,
      reclamationId: reclamation?.id,
      orderItemIds: requestedOrderItemIds,
      codAmount: options.codAmount,
      supplierFulfillmentId: supplierFulfillment?.id,
      pickupOverride:
        supplierPickup?.provider === "X_EXPRESS" ? supplierPickup.pickup : undefined,
    });
    return options.announceXExpress === false
      ? shipment
      : announceXExpressShipment(shipment.id);
  }

  if (routing.provider === "MYGLS") {
    const packages = options.packages ?? derivedPackages;
    const myGlsOptions = {
      purpose,
      reclamationId: reclamation?.id,
      pickupDate: options.pickupDate,
      packages,
      orderItemIds: requestedOrderItemIds,
      codAmount: options.codAmount,
      supplierFulfillmentId: supplierFulfillment?.id,
      pickupOverride:
        supplierPickup?.provider === "MYGLS" ? supplierPickup.pickup : undefined,
    };
    if (mode === "preflight") {
      await preflightMyGlsProviderShipmentForOrder(order.id, myGlsOptions);
      return;
    }
    return createMyGlsShipmentForOrder(order.id, myGlsOptions);
  }

  if (purpose === "RECLAMATION_RETURN") {
    throw new CourierConfigError(
      "Povrat kabaste robe zahteva ručni kamionski nalog; automatski obrnuti smer nije podržan.",
    );
  }

  if (mode === "preflight") return;

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
      (sum, item) => sum + courierPackageCount(item.qty),
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
  orderStatus: OrderStatus | null;
  customerEmail: string | null;
  customerPhone: string | null;
  eventCreated: boolean;
  stateApplied: boolean;
}

type ApplyShipmentEventOptions = {
  /**
   * Re-apply a verified provider snapshot even when its audit event already
   * exists or a legacy undated event poisoned `lastStatusEventAt` with the
   * ingestion time. Reserved for narrowly-gated provider recovery flows.
   */
  forceStateRecovery?: boolean;
};

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
  options: ApplyShipmentEventOptions = {},
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
  let appliedOrderStatus = newOrderStatus;
  const message = event.message ?? SHIPMENT_STATUS_LABEL[event.status];
  const selectedSmallProvider =
    service === "COURIER_SMALL"
      ? await getSelectedSmallParcelProvider()
      : null;
  const appliedProvider =
    shipment.provider ??
    (service === "COURIER_SMALL"
      ? selectedSmallProvider === "MYGLS"
        ? MYGLS_PROVIDER
        : X_EXPRESS_PROVIDER
      : null);
  let eventCreated = false;
  let stateApplied = false;

  await db.$transaction(async (tx) => {
    let duplicateEvent = false;
    if (event.providerEventId) {
      const duplicate = await tx.shipmentEvent.findUnique({
        where: { providerEventId: event.providerEventId },
        select: { id: true },
      });
      duplicateEvent = Boolean(duplicate);
    } else {
      const duplicate = await tx.shipmentEvent.findFirst({
        where: {
          shipmentId: shipment.id,
          status: event.status,
          occurredAt,
        },
        select: { id: true },
      });
      duplicateEvent = Boolean(duplicate);
    }
    if (duplicateEvent && !options.forceStateRecovery) {
      // Audit events are immutable, but their derived pickup-batch markers may
      // be missing after a legacy bug or interrupted transaction. Replaying a
      // verified proof event is therefore an idempotent self-healing pass.
      if (appliedProvider && PICKUP_PROOF_STATUSES.includes(event.status)) {
        await reconcilePickupBatchesFromShipment(tx, {
          orderId: shipment.orderId,
          reclamationId: shipment.reclamationId,
          purpose: shipment.purpose,
          provider: appliedProvider,
          rawCreateResponse: shipment.rawCreateResponse,
          occurredAt,
        });
      }
      return;
    }

    if (!duplicateEvent) {
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
    }

    const stateClaim = await tx.shipment.updateMany({
      where: options.forceStateRecovery
        ? {
            id: shipment.id,
            status: shipment.status,
            lastStatusEventAt: shipment.lastStatusEventAt,
          }
        : {
            id: shipment.id,
            OR: [
              { lastStatusEventAt: null },
              { lastStatusEventAt: { lte: occurredAt } },
            ],
          },
      data: {
        provider:
          appliedProvider ?? undefined,
        status: event.status,
        providerStatusCode: event.providerStatusCode ?? shipment.providerStatusCode,
        lastStatusEventAt: occurredAt,
        lastStatusSyncAt: new Date(),
        syncError: null,
        shippedAt:
          shipment.shippedAt ?? (event.status === "PICKED_UP" ? occurredAt : undefined),
        deliveredAt:
          event.status === "DELIVERED" ? occurredAt : shipment.deliveredAt ?? undefined,
      },
    });
    if (stateClaim.count === 0) return;
    stateApplied = true;

    if (
      shipment.purpose === "ORDER_DELIVERY" &&
      newOrderStatus === "ISPORUCENO"
    ) {
      const otherOpenShipments = await tx.shipment.count({
        where: {
          orderId: shipment.orderId,
          purpose: "ORDER_DELIVERY",
          id: { not: shipment.id },
          status: { notIn: ["DELIVERED", "RETURNED", "FAILED"] },
        },
      });
      if (otherOpenShipments > 0) appliedOrderStatus = "U_ISPORUCI";
    }
    if (shipment.purpose === "ORDER_DELIVERY" && appliedOrderStatus) {
      await tx.order.update({
        where: { id: shipment.orderId },
        data: { status: appliedOrderStatus },
      });
      await tx.orderStatusEvent.create({
        data: {
          orderId: shipment.orderId,
          status: appliedOrderStatus,
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
      const assignment = readShipmentAssignment(shipment.rawCreateResponse);
      await releaseOrderSupplierReservations(tx, shipment.orderId, {
        cancelled: false,
        supplierFulfillmentId: assignment?.supplierFulfillmentId,
        orderItemIds: assignment?.orderItemIds,
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
        const statusEvent = await tx.reclamationStatusEvent.create({
          data: {
            reclamationId: shipment.reclamationId,
            status: "RESENO",
            note: `Zamena/deo potvrđeno isporučen (${shipment.trackingNo ?? shipment.id}).`,
          },
          select: { id: true },
        });
        await enqueueBackgroundJob(
          {
            kind: "RECLAMATION_STATUS_EMAIL",
            payload: {
              reclamationId: shipment.reclamationId,
              eventId: statusEvent.id,
            },
            idempotencyKey: `reclamation-status-email:${statusEvent.id}`,
          },
          tx,
        );
      }
    }
    if (
      appliedProvider &&
      PICKUP_PROOF_STATUSES.includes(event.status)
    ) {
      await reconcilePickupBatchesFromShipment(tx, {
        orderId: shipment.orderId,
        reclamationId: shipment.reclamationId,
        purpose: shipment.purpose,
        provider: appliedProvider,
        rawCreateResponse: shipment.rawCreateResponse,
        occurredAt,
      });
    }
  });

  return {
    shipmentId: shipment.id,
    orderId: shipment.orderId,
    status: stateApplied ? event.status : shipment.status,
    orderStatus: stateApplied ? appliedOrderStatus : null,
    customerEmail: shipment.order.user?.email ?? shipment.order.guestEmail ?? null,
    customerPhone: shipment.order.user?.phone ?? shipment.order.shipPhone ?? null,
    eventCreated,
    stateApplied,
  };
}

const PICKUP_PROOF_STATUSES: ShipmentStatus[] = [
  "PICKED_UP",
  "IN_TRANSIT",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
  "RETURNED",
];

async function reconcilePickupBatchesFromShipment(
  tx: Prisma.TransactionClient,
  shipment: {
    orderId: string;
    reclamationId: string | null;
    purpose: ShipmentPurpose;
    provider: string;
    rawCreateResponse: unknown;
    occurredAt: Date;
  },
) {
  const candidateBatches = await tx.pickupBatch.findMany({
    where: {
      provider: shipment.provider,
      status: { in: ["BOOKED", "PICKED_UP"] },
      lines: {
        some:
          shipment.purpose === "RECLAMATION_REPLACEMENT" &&
          shipment.reclamationId
            ? {
                reclamationId: shipment.reclamationId,
                purpose: "RECLAMATION_REPLACEMENT",
              }
            : {
                orderId: shipment.orderId,
                purpose: "ORDER_DELIVERY",
              },
      },
    },
    select: {
      id: true,
    },
    orderBy: { id: "asc" },
  });

  for (const candidate of candidateBatches) {
    // Two provider events can complete different groups in the same batch at
    // the same time. Lock and then re-read the batch so the second transaction
    // observes the first committed pickup before it derives the aggregate
    // BOOKED/PICKED_UP state.
    await tx.$queryRaw(Prisma.sql`
      SELECT "id"
      FROM "PickupBatch"
      WHERE "id" = ${candidate.id}
      FOR UPDATE
    `);
    const batch = await tx.pickupBatch.findFirst({
      where: {
        id: candidate.id,
        provider: shipment.provider,
        status: { in: ["BOOKED", "PICKED_UP"] },
      },
      select: {
        id: true,
        lines: {
          select: {
            lineGroupKey: true,
            orderId: true,
            orderItemId: true,
            reclamationId: true,
            purpose: true,
          },
        },
      },
    });
    if (!batch) continue;
    const matchingLines = batch.lines.filter((line) => {
      if (shipment.purpose === "RECLAMATION_REPLACEMENT") {
        return Boolean(
          shipment.reclamationId &&
            line.purpose === "RECLAMATION_REPLACEMENT" &&
            line.reclamationId === shipment.reclamationId &&
            line.lineGroupKey === `reclamation:${shipment.reclamationId}`,
        );
      }
      return (
        line.purpose === "ORDER_DELIVERY" &&
        line.orderId === shipment.orderId &&
        line.lineGroupKey ===
          `order:${shipment.orderId}:${shipment.provider}`
      );
    });
    if (!matchingLines.length) continue;

    if (shipment.purpose === "ORDER_DELIVERY") {
      const groupItemIds = normalizeOrderItemIds(
        matchingLines.flatMap((line) =>
          line.orderItemId ? [line.orderItemId] : [],
        ),
      );
      const assignment = readShipmentAssignment(shipment.rawCreateResponse);
      if (
        assignment &&
        (!groupItemIds.length ||
          !sameShipmentAssignment(
            shipment.rawCreateResponse,
            groupItemIds,
          ))
      ) {
        continue;
      }
    }

    const groupKeys = Array.from(
      new Set(matchingLines.map((line) => line.lineGroupKey)),
    );
    await tx.pickupBatchLine.updateMany({
      where: {
        batchId: batch.id,
        lineGroupKey: { in: groupKeys },
        courierPickedUpAt: null,
      },
      data: {
        courierPickedUpAt: shipment.occurredAt,
        courierPickedUpById: null,
      },
    });
    const remainingPackages = await tx.pickupBatchLine.count({
      where: { batchId: batch.id, courierPickedUpAt: null },
    });
    await tx.pickupBatch.updateMany({
      where: { id: batch.id, status: { in: ["BOOKED", "PICKED_UP"] } },
      data: { status: remainingPackages === 0 ? "PICKED_UP" : "BOOKED" },
    });
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
