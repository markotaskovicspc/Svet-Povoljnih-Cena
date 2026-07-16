import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { canAccessOrder } from "@/lib/api/order-access";
import {
  isAllowedReclamationPhotoUrl,
  verifyReclamationUploads,
} from "@/lib/api/uploads";
import { enqueueBackgroundJob } from "@/lib/background-jobs";

/**
 * Reclamation flow (Phase 3C — item 5; spec §4.1).
 *
 * Public number is generated as `R-{n}-{orderNo}` where `n` is the number of
 * times that exact line item has already been reclaimed. The counter lives on
 * `OrderItem.reclamationCount` and is incremented in the same transaction.
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
  bytes: z.int().positive().max(5 * 1024 * 1024).optional(),
});

export const createReclamationSchema = z.object({
  /** Either an order number (`SPC-2026-…`) or a fiscal receipt number. */
  orderNumberOrFiscal: z.string().min(3).max(80),
  sku: z.string().min(1).max(64),
  customerFirst: z.string().trim().min(2).max(80),
  customerLast: z.string().trim().min(2).max(80),
  customerEmail: z.email().optional(),
  customerPhone: z.string().min(8).max(32).optional(),
  description: z.string().trim().min(5).max(250),
  notifyVia: z.enum(["EMAIL", "PHONE"]),
  photos: z.array(photoSchema).max(5).default([]),
  accessToken: z.string().min(16).max(256).optional(),
});

export type CreateReclamationInput = z.infer<typeof createReclamationSchema>;

export type CreateReclamationResult =
  | { ok: true; number: string; id: string }
  | {
      ok: false;
      reason: "ORDER_NOT_FOUND" | "ITEM_NOT_FOUND" | "MISSING_CONTACT" | "UNAUTHORIZED" | "INVALID_PHOTO";
    };

export async function lookupOrderForReclamation(orderNumberOrFiscal: string) {
  // Try order number first, then fiscal receipt number.
  const byNumber = await db.order.findUnique({
    where: { number: orderNumberOrFiscal },
    include: { items: true, fiscal: true },
  });
  if (byNumber) return byNumber;
  const fiscalDocument = await db.fiscalDocument.findFirst({
    where: { receiptNumber: orderNumberOrFiscal, kind: "SALE", status: "ISSUED" },
    include: { order: { include: { items: true, fiscal: true } } },
  });
  if (fiscalDocument) return fiscalDocument.order;
  const legacyFiscal = await db.fiscalReceipt.findUnique({
    where: { receiptNumber: orderNumberOrFiscal },
    include: { order: { include: { items: true, fiscal: true } } },
  });
  return legacyFiscal?.order ?? null;
}

export async function createReclamation(
  input: CreateReclamationInput,
  userId: string | null,
): Promise<CreateReclamationResult> {
  if (input.notifyVia === "EMAIL" && !input.customerEmail) {
    return { ok: false, reason: "MISSING_CONTACT" };
  }
  if (input.notifyVia === "PHONE" && !input.customerPhone) {
    return { ok: false, reason: "MISSING_CONTACT" };
  }

  const order = await lookupOrderForReclamation(input.orderNumberOrFiscal);
  if (!order) return { ok: false, reason: "ORDER_NOT_FOUND" };

  const item = order.items.find((i) => i.sku === input.sku);
  if (!item) return { ok: false, reason: "ITEM_NOT_FOUND" };
  if (!(await canAccessOrder({ order, token: input.accessToken }))) {
    return { ok: false, reason: "UNAUTHORIZED" };
  }
  try {
    await verifyReclamationUploads(input.photos, {
      orderNumber: order.number,
      sku: item.sku,
    });
  } catch {
    return { ok: false, reason: "INVALID_PHOTO" };
  }

  const result = await db.$transaction(async (tx) => {
    const updated = await tx.orderItem.update({
      where: { id: item.id },
      data: { reclamationCount: { increment: 1 } },
      select: { reclamationCount: true, productId: true },
    });

    const number = `R-${updated.reclamationCount}-${order.number}`;

    const reclamation = await tx.reclamation.create({
      data: {
        number,
        orderId: order.id,
        productId: updated.productId,
        sku: input.sku,
        customerFirst: input.customerFirst,
        customerLast: input.customerLast,
        customerEmail: input.customerEmail ?? null,
        customerPhone: input.customerPhone ?? null,
        description: input.description,
        notifyVia: input.notifyVia,
        userId,
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
          create: { status: "PRIMLJENO", note: "Reklamacija primljena" },
        },
      },
      select: { id: true, number: true },
    });

    return reclamation;
  });

  // Phase 4D: confirm receipt to the customer (only when they opted into
  // the email channel). BCC to the admin inbox is added by the sender.
  if (input.notifyVia === "EMAIL" && input.customerEmail) {
    await enqueueBackgroundJob({
      kind: "RECLAMATION_RECEIPT",
      payload: { reclamationId: result.id },
      idempotencyKey: `reclamation-receipt:${result.id}`,
    });
  }

  return { ok: true, id: result.id, number: result.number };
}

export async function listReclamationsForUser(userId: string) {
  // Hide solved reclamations after 10 days, per spec §4.1.
  const cutoff = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
  return db.reclamation.findMany({
    where: {
      userId,
      OR: [
        { status: { not: "RESENO" } },
        { resolvedAt: null },
        { resolvedAt: { gt: cutoff } },
      ],
    },
    orderBy: { createdAt: "desc" },
    include: {
      photos: true,
      events: { orderBy: { createdAt: "asc" } },
    },
  });
}
