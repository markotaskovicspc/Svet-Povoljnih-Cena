import "server-only";

import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { trackedDispatch } from "@/lib/email";
import { enqueueBackgroundJob } from "@/lib/background-jobs";
import { signReclamationPhotoUrls } from "@/lib/api/uploads";
import { syncProductChannelAvailability } from "@/lib/channel-availability.server";
import { isRabaluxSupplierOperational } from "./config";
import { canSendSupplierOrder } from "./fulfillment-state";
import {
  fulfillmentPaymentReadiness,
  isCashOnDeliveryPaymentMethod,
} from "@/lib/payments/fulfillment-readiness";
import {
  assertRabaluxSupplierAttachmentSet,
  buildRabaluxPackingPdf,
  buildRabaluxShipmentAttachments,
  buildRabaluxSupplierOrderAttachments,
} from "./documents";
import { X_EXPRESS_PROVIDER } from "@/lib/x-express/config";
import { BackgroundJobDeferredError } from "@/lib/background-job-deferral";
import { rabaluxCourierAvailableAt } from "./dispatch-policy";
import {
  supplierCancellationIdempotencyKey,
  supplierCancellationMessage,
  supplierOrderIdempotencyKey,
  supplierOrderMessage,
  supplierShippingDocumentsIdempotencyKey,
  supplierShippingDocumentsMessage,
} from "./messages";

function html(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export async function sendSupplierOrderEmail(args: {
  fulfillmentId: string;
  dispatchKey?: string;
}) {
  const fulfillment = await db.supplierFulfillment.findUnique({
    where: { id: args.fulfillmentId },
    include: {
      supplier: {
        select: {
          name: true,
          email: true,
          integrationKey: true,
          enabled: true,
        },
      },
      order: {
        select: {
          number: true,
          createdAt: true,
          paymentMethod: true,
          shippingMethod: true,
          payments: { select: { status: true } },
          guestEmail: true,
          user: { select: { email: true } },
          billingSameAsShipping: true,
          shipFirstName: true,
          shipLastName: true,
          shipPhone: true,
          shipStreet: true,
          shipCity: true,
          shipPostalCode: true,
          shipCompanyName: true,
          shipPib: true,
          billFirstName: true,
          billLastName: true,
          billStreet: true,
          billCity: true,
          billPostalCode: true,
          billCompanyName: true,
          billPib: true,
        },
      },
      items: {
        orderBy: { externalSku: "asc" },
        include: { orderItem: { select: { name: true } } },
      },
    },
  });
  if (!fulfillment) throw new Error("Supplier fulfillment does not exist.");
  if (fulfillment.status === "CANCELLED")
    return { skipped: "cancelled" as const };
  if (!canSendSupplierOrder(fulfillment.status)) {
    return { skipped: "terminal" as const };
  }
  if (
    fulfillment.supplier.integrationKey !== "RABALUX" ||
    !isRabaluxSupplierOperational(fulfillment.supplier)
  ) {
    throw new Error("Rabalux supplier integration is disabled.");
  }
  if (!fulfillment.supplier.email) {
    throw new Error("Supplier order email is not configured.");
  }
  const supplierItems = fulfillment.items.map((item) => ({
    externalSku: item.externalSku,
    qty: item.qty,
    name: item.orderItem.name,
  }));
  const message = supplierOrderMessage({
    orderNumber: fulfillment.order.number,
    items: supplierItems,
  });
  const attachments = await buildRabaluxSupplierOrderAttachments({
    orderNumber: fulfillment.order.number,
    createdAt: fulfillment.order.createdAt,
    items: supplierItems,
    shippingAddress: {
      firstName: fulfillment.order.shipFirstName,
      lastName: fulfillment.order.shipLastName,
      street: fulfillment.order.shipStreet,
      postalCode: fulfillment.order.shipPostalCode,
      city: fulfillment.order.shipCity,
      phone: fulfillment.order.shipPhone,
      email:
        fulfillment.order.user?.email ?? fulfillment.order.guestEmail ?? null,
      companyName: fulfillment.order.shipCompanyName,
      pib: fulfillment.order.shipPib,
    },
    billingAddress:
      !fulfillment.order.billingSameAsShipping &&
      fulfillment.order.billFirstName &&
      fulfillment.order.billLastName &&
      fulfillment.order.billStreet &&
      fulfillment.order.billCity &&
      fulfillment.order.billPostalCode
        ? {
            firstName: fulfillment.order.billFirstName,
            lastName: fulfillment.order.billLastName,
            street: fulfillment.order.billStreet,
            postalCode: fulfillment.order.billPostalCode,
            city: fulfillment.order.billCity,
            phone: fulfillment.order.shipPhone,
            email:
              fulfillment.order.user?.email ??
              fulfillment.order.guestEmail ??
              null,
            companyName: fulfillment.order.billCompanyName,
            pib: fulfillment.order.billPib,
          }
        : null,
  });
  const result = await trackedDispatch({
    kind: "supplier_order",
    to: fulfillment.supplier.email,
    ...message,
    attachments,
    tags: {
      kind: "supplier_order",
      fulfillment: fulfillment.id,
      order: fulfillment.order.number,
    },
    metadata: {
      attachmentNames: attachments.map((attachment) => attachment.filename),
      attachmentCount: attachments.length,
      supplierItemCount: supplierItems.length,
    },
    idempotencyKey: supplierOrderIdempotencyKey(
      fulfillment.id,
      args.dispatchKey,
    ),
  });
  if (!result.ok) {
    await db.supplierFulfillment.updateMany({
      where: {
        id: fulfillment.id,
        status: { in: ["PENDING", "FAILED", "SENT"] },
      },
      data: { status: "FAILED", lastError: result.error },
    });
    throw new Error(result.error);
  }
  const updated = await db.supplierFulfillment.updateMany({
    where: {
      id: fulfillment.id,
      status: { in: ["PENDING", "FAILED", "SENT"] },
    },
    data: { status: "SENT", sentAt: new Date(), lastError: null },
  });
  if (updated.count === 0) {
    const current = await db.supplierFulfillment.findUnique({
      where: { id: fulfillment.id },
      select: { status: true },
    });
    if (current?.status === "CANCELLED") {
      await enqueueBackgroundJob({
        kind: "SUPPLIER_CANCEL_EMAIL",
        payload: { fulfillmentId: fulfillment.id },
        idempotencyKey: `supplier-cancel:${fulfillment.id}`,
      });
    }
  }
  if (
    updated.count > 0 &&
    fulfillment.order.shippingMethod === "KURIR" &&
    fulfillmentPaymentReadiness({
      purpose: "ORDER_DELIVERY",
      paymentMethod: fulfillment.order.paymentMethod,
      paymentStatuses: fulfillment.order.payments.map((payment) => payment.status),
    }).ready
  ) {
    // An admin resend must recover both stages of an old failed fulfillment,
    // including orders created before the initial supplier email existed.
    await enqueueBackgroundJob({
      kind: "SUPPLIER_SHIPPING_DOCUMENTS_EMAIL",
      payload: { fulfillmentId: fulfillment.id, dispatchKey: args.dispatchKey },
      idempotencyKey: supplierShippingDocumentsIdempotencyKey(fulfillment.id, args.dispatchKey),
    });
  }
  return { skipped: null, result };
}

export async function enqueueSupplierShippingDocumentJobsForOrder(
  orderId: string,
  dispatchKey = "payment-ready",
) {
  const fulfillments = await db.supplierFulfillment.findMany({
    where: {
      orderId,
      supplier: { integrationKey: "RABALUX", enabled: true },
      status: { notIn: ["CANCELLED", "COMPLETED"] },
    },
    select: { id: true },
  });
  return Promise.all(
    fulfillments.map(({ id }) =>
      enqueueBackgroundJob({
        kind: "SUPPLIER_SHIPPING_DOCUMENTS_EMAIL",
        payload: { fulfillmentId: id, dispatchKey },
        idempotencyKey: supplierShippingDocumentsIdempotencyKey(
          id,
          dispatchKey,
        ),
      }),
    ),
  );
}

export async function sendSupplierShippingDocumentsEmail(args: {
  fulfillmentId: string;
  dispatchKey?: string;
}) {
  const fulfillment = await db.supplierFulfillment.findUnique({
    where: { id: args.fulfillmentId },
    include: {
      supplier: {
        select: {
          name: true,
          email: true,
          integrationKey: true,
          enabled: true,
        },
      },
      order: {
        select: {
          id: true,
          number: true,
          createdAt: true,
          total: true,
          paymentMethod: true,
          shippingMethod: true,
          payments: { select: { status: true } },
          items: { select: { id: true, warehouseReservedQty: true } },
        },
      },
      items: {
        orderBy: { externalSku: "asc" },
        include: { orderItem: { select: { id: true, name: true } } },
      },
    },
  });
  if (!fulfillment) throw new Error("Supplier fulfillment does not exist.");
  if (fulfillment.status === "CANCELLED")
    return { skipped: "cancelled" as const };
  if (fulfillment.status === "COMPLETED")
    return { skipped: "terminal" as const };
  // Also protect old queued jobs and direct/admin calls from same-day sends.
  const availableAt = rabaluxCourierAvailableAt(fulfillment.order.createdAt);
  if (Date.now() < availableAt.getTime()) {
    throw new BackgroundJobDeferredError(availableAt);
  }
  if (
    fulfillment.supplier.integrationKey !== "RABALUX" ||
    !isRabaluxSupplierOperational(fulfillment.supplier)
  ) {
    throw new Error("Rabalux supplier integration is disabled.");
  }
  if (!fulfillment.supplier.email) {
    throw new Error("Supplier order email is not configured.");
  }
  if (!fulfillment.sentAt) {
    throw new Error(
      "Rabalux porudžbina još nije uspešno poslata; adresnica i kurirski nalog čekaju taj korak.",
    );
  }
  if (fulfillment.order.shippingMethod !== "KURIR") {
    throw new Error(
      "Rabalux dropship trenutno podržava samo kurirsku isporuku.",
    );
  }
  const paymentReadiness = fulfillmentPaymentReadiness({
    purpose: "ORDER_DELIVERY",
    paymentMethod: fulfillment.order.paymentMethod,
    paymentStatuses: fulfillment.order.payments.map(
      (payment) => payment.status,
    ),
  });
  if (!paymentReadiness.ready) {
    throw new Error(paymentReadiness.reason);
  }

  const orderItemIds = fulfillment.items.map((item) => item.orderItem.id);
  const mixedOrder = fulfillment.order.items.some((item) => item.warehouseReservedQty > 0)
    || orderItemIds.length !== fulfillment.order.items.length;
  const cashOnDelivery = isCashOnDeliveryPaymentMethod(
    fulfillment.order.paymentMethod,
  );
  // Rabalux must not see the commercial value of a mixed order. Its direct
  // shipment therefore carries no COD; the DC shipment collects the full
  // order amount. A supplier-only COD order has no DC shipment, so its own
  // label remains the collection point.
  const codAmount =
    cashOnDelivery && !mixedOrder ? Number(fulfillment.order.total) : 0;
  const codCollectionPlan = !cashOnDelivery
    ? "PREPAID"
    : mixedOrder
      ? "DC_FULL_ORDER"
      : "RABALUX_FULL_ORDER";

  try {
    const { announceXExpressShipment } =
      await import("@/lib/x-express/shipments");
    const { createShipmentForOrder } = await import("@/lib/courier/registry");
    let shipment = await createShipmentForOrder(fulfillment.order.id, {
      orderItemIds,
      supplierFulfillmentId: fulfillment.id,
      provider: X_EXPRESS_PROVIDER,
      codAmount,
      announceXExpress: false,
    });
    if (
      shipment.provider === X_EXPRESS_PROVIDER &&
      !shipment.providerShipmentId
    ) {
      shipment = await announceXExpressShipment(shipment.id);
    }
    const packingPdf = buildRabaluxPackingPdf({
      orderNumber: fulfillment.order.number,
      items: fulfillment.items.map((item) => ({
        externalSku: item.externalSku,
        qty: item.qty,
        name: item.orderItem.name,
      })),
    });
    const attachments = await buildRabaluxShipmentAttachments({
      shipmentId: shipment.id,
      orderNumber: fulfillment.order.number,
      packingPdf,
    });
    assertRabaluxSupplierAttachmentSet(attachments);
    const message = supplierShippingDocumentsMessage({
      orderNumber: fulfillment.order.number,
      trackingNo: shipment.trackingNo,
      items: fulfillment.items,
    });
    const result = await trackedDispatch({
      kind: "supplier_shipping_documents",
      to: fulfillment.supplier.email,
      ...message,
      attachments,
      tags: {
        kind: "supplier_shipping_documents",
        fulfillment: fulfillment.id,
        order: fulfillment.order.number,
      },
      metadata: {
        attachmentNames: attachments.map((attachment) => attachment.filename),
        attachmentCount: attachments.length,
        supplierItemCount: fulfillment.items.length,
        shipmentId: shipment.id,
        provider: shipment.provider,
        trackingNo: shipment.trackingNo,
        courierRequestAccepted: Boolean(shipment.providerShipmentId),
        codCollectionPlan,
      },
      idempotencyKey: supplierShippingDocumentsIdempotencyKey(
        fulfillment.id,
        args.dispatchKey,
      ),
    });
    if (!result.ok) throw new Error(result.error);
    await db.supplierFulfillment.updateMany({
      where: {
        id: fulfillment.id,
        status: { notIn: ["CANCELLED", "COMPLETED"] },
      },
      data: {
        status: "PICKUP_READY",
        sentAt: fulfillment.sentAt ?? new Date(),
        confirmedAt: new Date(),
        lastError: null,
      },
    });
    return { skipped: null, result, shipmentId: shipment.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.supplierFulfillment.updateMany({
      where: {
        id: fulfillment.id,
        status: { notIn: ["CANCELLED", "COMPLETED"] },
      },
      data: { status: "FAILED", lastError: message },
    });
    throw error;
  }
}

export async function sendSupplierCancellationEmail(fulfillmentId: string) {
  const fulfillment = await db.supplierFulfillment.findUnique({
    where: { id: fulfillmentId },
    include: {
      supplier: {
        select: { email: true, integrationKey: true, enabled: true },
      },
      order: { select: { number: true } },
      items: { orderBy: { externalSku: "asc" } },
    },
  });
  if (!fulfillment?.sentAt) return { skipped: "not_sent" as const };
  if (
    fulfillment.supplier.integrationKey === "RABALUX" &&
    !isRabaluxSupplierOperational(fulfillment.supplier)
  ) {
    throw new Error("Supplier integration is disabled.");
  }
  if (!fulfillment.supplier.email) {
    throw new Error("Supplier cancellation email is not configured.");
  }
  const message = supplierCancellationMessage({
    orderNumber: fulfillment.order.number,
    items: fulfillment.items,
  });
  const result = await trackedDispatch({
    kind: "supplier_order_cancellation",
    to: fulfillment.supplier.email,
    ...message,
    tags: {
      kind: "supplier_order_cancellation",
      fulfillment: fulfillment.id,
      order: fulfillment.order.number,
    },
    idempotencyKey: supplierCancellationIdempotencyKey(fulfillment.id),
  });
  if (!result.ok) throw new Error(result.error);
  return { skipped: null, result };
}

export async function sendSupplierReclamationEmail(reclamationId: string) {
  const reclamation = await db.reclamation.findUnique({
    where: { id: reclamationId },
    include: {
      order: { select: { number: true } },
      orderItem: {
        select: {
          qty: true,
          supplierExternalSku: true,
          product: {
            select: {
              supplier: {
                select: { email: true, integrationKey: true, enabled: true },
              },
            },
          },
        },
      },
      photos: { select: { url: true } },
    },
  });
  if (
    !reclamation?.orderItem?.supplierExternalSku ||
    reclamation.orderItem.product?.supplier?.integrationKey !== "RABALUX"
  ) {
    return { skipped: "not_rabalux" as const };
  }
  if (!isRabaluxSupplierOperational(reclamation.orderItem.product.supplier)) {
    throw new Error("Supplier integration is disabled.");
  }
  const recipient = reclamation.orderItem.product.supplier.email;
  if (!recipient)
    throw new Error("Supplier reclamation email is not configured.");
  const signed = await signReclamationPhotoUrls(
    reclamation.photos.map((photo) => photo.url),
    7 * 24 * 60 * 60,
  );
  const photoUrls = reclamation.photos
    .map((photo) => signed.get(photo.url))
    .filter((value): value is string => Boolean(value));
  const photoText = photoUrls.length
    ? `\nZaštićene fotografije (važe 7 dana):\n${photoUrls.join("\n")}`
    : "";
  const photoHtml = photoUrls.length
    ? `<p>Zaštićene fotografije (važe 7 dana):</p><ul>${photoUrls
        .map((url) => `<li><a href="${html(url)}">Fotografija</a></li>`)
        .join("")}</ul>`
    : "";
  const result = await trackedDispatch({
    kind: "supplier_reclamation",
    to: recipient,
    subject: `Reklamacija ${reclamation.number} / ${reclamation.order.number}`,
    html: `<p>Poštovani,</p><p>prijavljujemo reklamaciju za Rabalux šifru <strong>${html(
      reclamation.orderItem.supplierExternalSku,
    )}</strong>, količina ${reclamation.orderItem.qty}.</p><p>${html(
      reclamation.description,
    )}</p>${photoHtml}<p>Očekivano rešenje: zamenski artikal ili povraćaj novca.</p>`,
    text: `Reklamacija ${reclamation.number}\nPorudžbina: ${reclamation.order.number}\nRabalux šifra: ${reclamation.orderItem.supplierExternalSku}\nKoličina: ${reclamation.orderItem.qty}\nProblem: ${reclamation.description}${photoText}\n\nOčekivano rešenje: zamenski artikal ili povraćaj novca.`,
    tags: {
      kind: "supplier_reclamation",
      reclamation: reclamation.number,
    },
    idempotencyKey: `supplier-reclamation:${reclamation.id}`,
  });
  await db.reclamation.update({
    where: { id: reclamation.id },
    data: result.ok
      ? { supplierNotifiedAt: new Date(), supplierNotificationError: null }
      : { supplierNotificationError: result.error },
  });
  if (!result.ok) throw new Error(result.error);
  return { skipped: null, result };
}

export async function releaseOrderSupplierReservations(
  tx: Prisma.TransactionClient,
  orderId: string,
  options: {
    cancelled: boolean;
    supplierFulfillmentId?: string;
    orderItemIds?: readonly string[];
  },
) {
  const rows = await tx.$queryRaw<
    Array<{
      id: string;
      sentAt: Date | null;
      status:
        | "PENDING"
        | "SENT"
        | "CONFIRMED"
        | "PICKUP_READY"
        | "CANCELLED"
        | "COMPLETED"
        | "FAILED";
    }>
  >`
    SELECT "id", "sentAt", "status"
    FROM "SupplierFulfillment"
    WHERE "orderId" = ${orderId}
    ORDER BY "id"
    FOR UPDATE
  `;
  const cancellationIds: string[] = [];
  for (const row of rows) {
    if (options.cancelled && row.status === "COMPLETED") continue;
    if (!options.cancelled && row.status === "CANCELLED") continue;
    const fulfillment = await tx.supplierFulfillment.findUniqueOrThrow({
      where: { id: row.id },
      include: {
        items: { select: { orderItemId: true, productId: true, qty: true } },
      },
    });
    if (
      options.supplierFulfillmentId &&
      fulfillment.id !== options.supplierFulfillmentId
    ) {
      continue;
    }
    if (
      options.orderItemIds?.length &&
      !fulfillment.items.some((item) =>
        options.orderItemIds!.includes(item.orderItemId),
      )
    ) {
      continue;
    }
    if (!fulfillment.reservationReleasedAt) {
      for (const item of fulfillment.items) {
        if (!item.productId) continue;
        const updated = await tx.product.updateMany({
          where: {
            id: item.productId,
            supplierReservedStock: { gte: item.qty },
          },
          data: { supplierReservedStock: { decrement: item.qty } },
        });
        if (updated.count !== 1) {
          throw new Error("Supplier reservation balance is inconsistent.");
        }
        await syncProductChannelAvailability(tx, item.productId);
      }
    }
    await tx.supplierFulfillment.update({
      where: { id: fulfillment.id },
      data: options.cancelled
        ? {
            status: "CANCELLED",
            cancelledAt: fulfillment.cancelledAt ?? new Date(),
            reservationReleasedAt:
              fulfillment.reservationReleasedAt ?? new Date(),
          }
        : {
            status: "COMPLETED",
            completedAt: fulfillment.completedAt ?? new Date(),
            reservationReleasedAt:
              fulfillment.reservationReleasedAt ?? new Date(),
          },
    });
    if (options.cancelled && row.sentAt) cancellationIds.push(row.id);
  }
  return cancellationIds;
}

export async function assertSupplierPickupConfirmed(
  orderId: string,
  orderItemIds: readonly string[] = [],
) {
  const blocking = await db.supplierFulfillment.findFirst({
    where: {
      orderId,
      supplier: { integrationKey: "RABALUX" },
      ...(orderItemIds.length
        ? { items: { some: { orderItemId: { in: [...orderItemIds] } } } }
        : {}),
      OR: [
        { status: { notIn: ["CONFIRMED", "PICKUP_READY", "COMPLETED"] } },
        { loadingLocationId: null },
        { loadingLocation: { is: { address: null } } },
        { loadingLocation: { is: { city: null } } },
      ],
    },
    select: { id: true },
  });
  if (blocking) {
    throw new Error(
      "Kurir se ne može kreirati dok Rabalux ne potvrdi popunjeno mesto preuzimanja.",
    );
  }
}
