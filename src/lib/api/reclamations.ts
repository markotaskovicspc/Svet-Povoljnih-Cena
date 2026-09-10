import "server-only";
import type {
  OrderStatus,
  ReclamationRequest,
  ReclamationType,
} from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  nextReclamationNumber,
  reclamationHistorySelect,
  serializeReclamationHistory,
} from "@/lib/reclamation-options";
import {
  isAllowedReclamationPhotoUrl,
  verifyReclamationUploads,
} from "@/lib/api/uploads";
import { enqueueBackgroundJob } from "@/lib/background-jobs";
import { logOperationalError } from "@/lib/monitoring";
import { formatProductDisplayName } from "@/lib/product-name";
import { verifyOrderAccessToken } from "@/lib/api/order-access";

/**
 * Reclamation flow (Phase 3C — item 5; spec §4.1).
 *
 * Public number is generated as `R-{n}-{orderNo}` where `n` is the next
 * sequence across the order, allocated under an order row lock. The item
 * counter remains a statistic, incremented in the same transaction.
 *
 * Photos are uploaded out-of-band via the presigned URL endpoint (`uploads.ts`)
 * and the resulting URLs are passed in `photos[]` on creation.
 */

const photoSchema = z.object({
  url: z.string().min(1).max(1000).refine(isAllowedReclamationPhotoUrl, {
    message: "Fotografija mora biti poslata kroz zaštićeni upload tok.",
  }),
  width: z.int().positive().optional(),
  height: z.int().positive().optional(),
  bytes: z.int().positive().max(2 * 1024 * 1024).optional(),
});

export const createReclamationSchema = z.object({
  /** Either an order number (`SPC-2026-…`) or a fiscal receipt number. */
  orderNumberOrFiscal: z.string().min(3).max(80),
  sku: z.string().min(1).max(64),
  quantity: z.int().min(1).max(999),
  description: z.string().trim().min(5).max(250),
  photos: z.array(photoSchema).max(5).default([]),
});

export type CreateReclamationInput = z.infer<typeof createReclamationSchema>;

export type CreateReclamationResult =
  | { ok: true; number: string; id: string }
  | {
      ok: false;
      reason:
        | "ORDER_NOT_FOUND"
        | "ORDER_NOT_DELIVERED"
        | "ITEM_NOT_FOUND"
        | "UNAUTHORIZED"
        | "INVALID_PHOTO"
        | "QUANTITY_EXCEEDED";
    };

export async function lookupOrderForReclamation(orderNumberOrFiscal: string) {
  // Try order number first, then fiscal receipt number.
  const byNumber = await db.order.findUnique({
    where: { number: orderNumberOrFiscal },
    include: {
      items: { include: { reclamations: { select: reclamationHistorySelect } } },
      fiscal: true,
    },
  });
  if (byNumber) return byNumber;
  const fiscalDocument = await db.fiscalDocument.findFirst({
    where: { receiptNumber: orderNumberOrFiscal, kind: "SALE", status: "ISSUED" },
    include: {
      order: {
        include: {
          items: { include: { reclamations: { select: reclamationHistorySelect } } },
          fiscal: true,
        },
      },
    },
  });
  if (fiscalDocument) return fiscalDocument.order;
  const legacyFiscal = await db.fiscalReceipt.findUnique({
    where: { receiptNumber: orderNumberOrFiscal },
    include: {
      order: {
        include: {
          items: { include: { reclamations: { select: reclamationHistorySelect } } },
          fiscal: true,
        },
      },
    },
  });
  return legacyFiscal?.order ?? null;
}

export async function createReclamation(
  input: CreateReclamationInput,
  userId: string,
): Promise<CreateReclamationResult> {
  return createReclamationRecord(input, {
    expectedUserId: userId,
    allowedOrderStatuses: ["ISPORUCENO"],
  });
}

export async function createGuestReclamation(
  input: CreateReclamationInput,
  accessToken: string | null | undefined,
): Promise<CreateReclamationResult> {
  return createReclamationRecord(input, {
    guestAccessToken: accessToken ?? null,
    allowedOrderStatuses: ["ISPORUCENO"],
  });
}

export async function createAdminReclamation(
  input: CreateReclamationInput & {
    type?: ReclamationType | null;
    request?: ReclamationRequest | null;
  },
  actorId: string,
): Promise<CreateReclamationResult> {
  return createReclamationRecord(input, {
    actorId,
    // An operator must be able to record a buyer's report even when the order
    // status is stale or exceptional. Public customer and guest flows remain
    // delivery-only.
    type: input.type,
    request: input.request,
  });
}

async function createReclamationRecord(
  input: CreateReclamationInput,
  options: {
    expectedUserId?: string;
    guestAccessToken?: string | null;
    actorId?: string;
    allowedOrderStatuses?: readonly OrderStatus[];
    type?: ReclamationType | null;
    request?: ReclamationRequest | null;
  },
): Promise<CreateReclamationResult> {
  const order = await lookupOrderForReclamation(input.orderNumberOrFiscal);
  if (!order) return { ok: false, reason: "ORDER_NOT_FOUND" };
  if (options.expectedUserId && order.userId !== options.expectedUserId) {
    return { ok: false, reason: "UNAUTHORIZED" };
  }
  if (
    options.guestAccessToken !== undefined &&
    (order.userId !== null ||
      !verifyOrderAccessToken({
        token: options.guestAccessToken,
        tokenHash: order.publicAccessTokenHash,
      }))
  ) {
    return { ok: false, reason: "UNAUTHORIZED" };
  }
  if (
    options.allowedOrderStatuses &&
    !options.allowedOrderStatuses.includes(order.status)
  ) {
    return { ok: false, reason: "ORDER_NOT_DELIVERED" };
  }

  const item = order.items.find((i) => i.sku === input.sku);
  if (!item) return { ok: false, reason: "ITEM_NOT_FOUND" };
  const account = order.userId
    ? await db.user.findUnique({
        where: { id: order.userId },
        select: {
          firstName: true,
          lastName: true,
          name: true,
          email: true,
          phone: true,
        },
      })
    : null;
  const [nameFirst, ...nameLast] = (account?.name ?? "").trim().split(/\s+/);
  const customerFirst =
    account?.firstName?.trim() || nameFirst || order.shipFirstName;
  const customerLast =
    account?.lastName?.trim() || nameLast.join(" ") || order.shipLastName;
  const customerPhone = account?.phone?.trim() || order.shipPhone || null;
  try {
    await verifyReclamationUploads(input.photos, {
      orderNumber: order.number,
      sku: item.sku,
    });
  } catch {
    return { ok: false, reason: "INVALID_PHOTO" };
  }

  let result: { id: string; number: string };
  try {
    result = await db.$transaction(async (tx) => {
      // Serialize every creation for this order, including different SKUs and
      // admin submissions. Always lock the order before its item.
      const [lockedOrder] = await tx.$queryRaw<Array<{ status: string; number: string }>>`
        SELECT status::text AS status, number
        FROM "Order"
        WHERE id = ${order.id}
        FOR UPDATE
      `;
      if (!lockedOrder) throw new Error("Porudžbina više ne postoji.");
      if (
        options.allowedOrderStatuses &&
        !options.allowedOrderStatuses.includes(lockedOrder.status as OrderStatus)
      ) {
        throw new ReclamationOrderStatusError();
      }

      const [updated] = await tx.$queryRaw<
        Array<{ reclamationCount: number; productId: string | null; qty: number }>
      >`
        UPDATE "OrderItem"
        SET "reclamationCount" = "reclamationCount" + 1
        WHERE id = ${item.id}
        RETURNING "reclamationCount", "productId", qty
      `;
      if (!updated) throw new Error("Stavka porudžbine više ne postoji.");

      // A new report may concern an already reported unit. Only this report's
      // quantity is bounded by the purchased quantity; history is never deducted.
      if (
        !Number.isInteger(input.quantity) || input.quantity < 1 ||
        input.quantity > Math.min(updated.qty, 999)
      ) {
        throw new ReclamationQuantityError();
      }

      const existing = await tx.reclamation.findMany({
        where: { orderId: order.id },
        select: { number: true },
      });
      const number = nextReclamationNumber(
        lockedOrder.number,
        existing.map((row) => row.number),
      );

      return tx.reclamation.create({
        data: {
          number,
          orderId: order.id,
          orderItemId: item.id,
          productId: updated.productId,
          sku: input.sku,
          quantity: input.quantity,
          customerFirst,
          customerLast,
          customerEmail: account?.email ?? order.guestEmail ?? null,
          customerPhone,
          description: input.description,
          // Registered customers follow the case in their account. Guests do
          // not have a portal, so their receipt and every status change must go
          // to the e-mail address captured on the order.
          notifyVia: order.userId ? "PHONE" : "EMAIL",
          purchaseDate: options.actorId ? order.createdAt : undefined,
          type: options.type ?? undefined,
          request: options.request ?? undefined,
          userId: order.userId,
          photos: input.photos.length
            ? {
                createMany: {
                  data: input.photos.map((p) => ({
                    url: p.url,
                    width: p.width ?? null,
                    height: p.height ?? null,
                    bytes: p.bytes ?? null,
                  })),
                },
              }
            : undefined,
          events: {
            create: {
              status: "PRIMLJENO",
              note: options.actorId
                ? "Reklamacija ručno uneta u administraciji"
                : "Reklamacija primljena",
              actorId: options.actorId ?? null,
            },
          },
        },
        select: { id: true, number: true },
      });
    });
  } catch (error) {
    if (error instanceof ReclamationQuantityError) {
      return { ok: false, reason: "QUANTITY_EXCEEDED" };
    }
    if (error instanceof ReclamationOrderStatusError) {
      return { ok: false, reason: "ORDER_NOT_DELIVERED" };
    }
    throw error;
  }

  try {
    await enqueueBackgroundJob({
      kind: "RECLAMATION_RECEIPT",
      payload: { reclamationId: result.id },
      idempotencyKey: `reclamation-receipt:${result.id}`,
    });
  } catch (error) {
    logOperationalError("reclamation.receipt_enqueue_failed", error, {
      reclamationId: result.id,
    });
  }

  if (item.supplierExternalSku) {
    try {
      await enqueueBackgroundJob({
        kind: "SUPPLIER_RECLAMATION_EMAIL",
        payload: { reclamationId: result.id },
        idempotencyKey: `supplier-reclamation:${result.id}`,
      });
    } catch (error) {
      // The reclamation is already committed. A transient background-queue
      // failure must not turn a successful customer submission into a 500.
      logOperationalError("reclamation.supplier_notification_enqueue_failed", error, {
        reclamationId: result.id,
        sku: item.sku,
      });
    }
  }

  return { ok: true, id: result.id, number: result.number };
}

export async function getGuestOrderForReclamation(
  orderNumberOrFiscal: string,
  accessToken: string | null | undefined,
) {
  const order = await lookupOrderForReclamation(orderNumberOrFiscal);
  if (
    !order ||
    order.userId !== null ||
    order.status !== "ISPORUCENO" ||
    !verifyOrderAccessToken({
      token: accessToken,
      tokenHash: order.publicAccessTokenHash,
    })
  ) {
    return null;
  }

  const items = order.items
    .filter((item) => item.qty > 0)
    .map((item) => ({
      sku: item.sku,
      name: formatProductDisplayName(item.name, item.attribute1),
      purchasedQty: item.qty,
      reclamations: serializeReclamationHistory(item.reclamations),
    }));

  return items.length
    ? { number: order.number, createdAt: order.createdAt, items }
    : null;
}

export async function listReclamationsForUser(userId: string) {
  return db.reclamation.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    include: {
      photos: true,
      events: { orderBy: { createdAt: "asc" } },
    },
  });
}

export async function listOrdersForReclamation(userId: string) {
  const orders = await db.order.findMany({
    where: { userId, status: "ISPORUCENO" },
    orderBy: { createdAt: "desc" },
    select: {
      number: true,
      createdAt: true,
      items: {
        orderBy: { id: "asc" },
        select: {
          id: true,
          sku: true,
          name: true,
          attribute1: true,
          qty: true,
          reclamations: { select: reclamationHistorySelect },
        },
      },
    },
  });

  return orders
    .map((order) => ({
      ...order,
      items: order.items
        .filter((item) => item.qty > 0)
        .map((item) => ({
          sku: item.sku,
          name: formatProductDisplayName(item.name, item.attribute1),
          purchasedQty: item.qty,
          reclamations: serializeReclamationHistory(item.reclamations),
        })),
    }))
    .filter((order) => order.items.length > 0);
}

class ReclamationQuantityError extends Error {}
class ReclamationOrderStatusError extends Error {}
