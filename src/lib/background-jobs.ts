import "server-only";

import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { redactText } from "@/lib/monitoring";
import { expirePartnerReservations } from "@/lib/channel-availability.server";

const schemas = {
  PASSWORD_RESET_EMAIL: z.object({ to: z.email(), token: z.string().min(20) }),
  BUYER_RECEIPT: z.object({ orderId: z.string().min(1) }),
  SUPPLIER_RESERVATION: z.object({
    orderNumber: z.string().min(1),
    lines: z.array(z.object({ productId: z.string().min(1), qty: z.number().int().positive() })).min(1),
  }),
  NEWSLETTER_SYNC: z.object({ email: z.email() }),
  MARKETING_SYNC: z.object({ userId: z.string().min(1) }),
  RESEND_CONTACT_UNSUBSCRIBE: z.object({ email: z.email() }),
  FISCAL_RECEIPT: z.object({
    orderId: z.string().min(1),
    source: z.enum(["AUTO_ADVANCE", "AUTO_PICKUP", "MANUAL"]).optional(),
    paymentMethod: z.enum(["IPS", "KARTICA", "APPLE_PAY", "GOOGLE_PAY", "POUZECE_GOTOVINA", "POUZECE_KARTICA", "UPLATA_NA_RACUN"]).optional(),
  }),
  ORDER_STATUS_EMAIL: z.object({ orderId: z.string().min(1) }),
  IPS_PAYMENT_EMAIL: z.object({ orderId: z.string().min(1) }),
  RECLAMATION_RECEIPT: z.object({ reclamationId: z.string().min(1) }),
  RECLAMATION_STATUS_EMAIL: z.object({ reclamationId: z.string().min(1) }),
  RABALUX_MEDIA_PRODUCT: z.object({
    productId: z.string().min(1),
    assetId: z.string().min(1).optional(),
    assetType: z.enum(["MEDIA", "ATTACHMENT"]).optional(),
  }),
  SUPPLIER_ORDER_EMAIL: z.object({
    fulfillmentId: z.string().min(1),
    dispatchKey: z.string().min(1).max(80).optional(),
  }),
  SUPPLIER_CANCEL_EMAIL: z.object({ fulfillmentId: z.string().min(1) }),
  SUPPLIER_RECLAMATION_EMAIL: z.object({ reclamationId: z.string().min(1) }),
} as const;

export type BackgroundJobKind = keyof typeof schemas;

type JobRow = {
  id: string;
  kind: string;
  payload: Prisma.JsonValue;
  attempts: number;
  maxAttempts: number;
};

export class PermanentBackgroundJobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermanentBackgroundJobError";
  }
}

export async function enqueueBackgroundJob<K extends BackgroundJobKind>(args: {
  kind: K;
  payload: z.input<(typeof schemas)[K]>;
  idempotencyKey: string;
  maxAttempts?: number;
}) {
  const payload = schemas[args.kind].parse(args.payload);
  try {
    return await db.backgroundJob.create({
      data: {
        kind: args.kind,
        payload: payload as Prisma.InputJsonValue,
        idempotencyKey: args.idempotencyKey.slice(0, 200),
        maxAttempts: args.maxAttempts ?? 8,
      },
      select: { id: true, status: true },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const existing = await db.backgroundJob.findUniqueOrThrow({
        where: { idempotencyKey: args.idempotencyKey.slice(0, 200) },
        select: { id: true, status: true, lastError: true },
      });
      if (
        existing.status === "FAILED" &&
        !existing.lastError?.startsWith("[permanent]")
      ) {
        return db.backgroundJob.update({
          where: { id: existing.id },
          data: {
            payload: payload as Prisma.InputJsonValue,
            status: "QUEUED",
            attempts: 0,
            availableAt: new Date(),
            lockedAt: null,
            completedAt: null,
            lastError: null,
          },
          select: { id: true, status: true },
        });
      }
      return { id: existing.id, status: existing.status };
    }
    throw error;
  }
}

export async function processBackgroundJob(id: string) {
  const rows = await db.$queryRaw<JobRow[]>`
    UPDATE "BackgroundJob"
       SET "status" = 'RUNNING',
           "attempts" = "attempts" + 1,
           "lockedAt" = NOW(),
           "updatedAt" = NOW()
     WHERE "id" = ${id}
       AND "availableAt" <= NOW()
       AND (
         "status" IN ('QUEUED', 'RETRY')
         OR ("status" = 'RUNNING' AND "lockedAt" < NOW() - INTERVAL '15 minutes')
       )
    RETURNING "id", "kind", "payload", "attempts", "maxAttempts"
  `;
  const job = rows[0];
  if (!job) return { claimed: false as const };

  try {
    await dispatchJob(job);
    await db.backgroundJob.update({
      where: { id: job.id },
      data: {
        status: "COMPLETED",
        payload: {},
        lockedAt: null,
        completedAt: new Date(),
        lastError: null,
      },
    });
    return { claimed: true as const, ok: true as const };
  } catch (error) {
    const permanent = error instanceof PermanentBackgroundJobError;
    const exhausted = permanent || job.attempts >= job.maxAttempts;
    const delaySeconds = Math.min(3600, 15 * 2 ** Math.min(job.attempts, 8));
    await db.backgroundJob.update({
      where: { id: job.id },
      data: {
        status: exhausted ? "FAILED" : "RETRY",
        lockedAt: null,
        lastError: `${permanent ? "[permanent] " : ""}${safeError(error)}`,
        availableAt: exhausted ? new Date() : new Date(Date.now() + delaySeconds * 1000),
      },
    });
    return {
      claimed: true as const,
      ok: false as const,
      exhausted,
      permanent,
    };
  }
}

export async function processPendingBackgroundJobs(limit = 20) {
  const now = new Date();
  const stale = new Date(now.getTime() - 15 * 60 * 1000);
  const candidates = await db.backgroundJob.findMany({
    where: {
      availableAt: { lte: now },
      OR: [
        { status: { in: ["QUEUED", "RETRY"] } },
        { status: "RUNNING", lockedAt: { lt: stale } },
      ],
    },
    orderBy: [{ availableAt: "asc" }, { createdAt: "asc" }],
    take: Math.min(Math.max(limit, 1), 100),
    select: { id: true, kind: true },
  });
  const media = candidates.filter(({ kind }) => kind === "RABALUX_MEDIA_PRODUCT");
  const other = candidates.filter(({ kind }) => kind !== "RABALUX_MEDIA_PRODUCT");
  const results = await Promise.all(other.map(({ id }) => processBackgroundJob(id)));
  const mediaConcurrency = Math.min(
    Math.max(Number(process.env.RABALUX_MEDIA_WORKER_CONCURRENCY) || 2, 1),
    2,
  );
  for (let start = 0; start < media.length; start += mediaConcurrency) {
    results.push(
      ...(await Promise.all(
        media
          .slice(start, start + mediaConcurrency)
          .map(({ id }) => processBackgroundJob(id)),
      )),
    );
  }
  const [, , , partnerReservations] = await Promise.all([
    db.backgroundJob.deleteMany({
      where: { status: "COMPLETED", completedAt: { lt: new Date(now.getTime() - 30 * 86400_000) } },
    }),
    db.rateLimitBucket.deleteMany({ where: { resetAt: { lt: now } } }),
    db.paymentRefund.updateMany({
      where: {
        status: "PENDING",
        updatedAt: { lt: new Date(now.getTime() - 15 * 60 * 1000) },
      },
      data: {
        status: "NEEDS_REVIEW",
        error: "Refund submission did not reach a final recorded state; reconcile with provider before retrying.",
      },
    }),
    expirePartnerReservations(),
  ]);
  return {
    selected: candidates.length,
    completed: results.filter((result) => result.claimed && result.ok).length,
    failed: results.filter((result) => result.claimed && !result.ok).length,
    releasedPartnerReservations: partnerReservations.released,
  };
}

async function dispatchJob(job: JobRow) {
  if (!(job.kind in schemas)) throw new Error(`Unsupported background job: ${job.kind}`);
  const kind = job.kind as BackgroundJobKind;
  const payload = schemas[kind].parse(job.payload);

  switch (kind) {
    case "PASSWORD_RESET_EMAIL": {
      const { sendPasswordReset } = await import("@/lib/email");
      const result = await sendPasswordReset(payload as z.infer<typeof schemas.PASSWORD_RESET_EMAIL>);
      if (!result.ok) throw new Error(result.error);
      return;
    }
    case "BUYER_RECEIPT": {
      const { issueBuyerReceiptForOrder } = await import("@/lib/receipts/buyer");
      const result = await issueBuyerReceiptForOrder((payload as z.infer<typeof schemas.BUYER_RECEIPT>).orderId);
      if (!result.ok || result.emailError) throw new Error(result.ok ? result.emailError ?? "receipt_email_failed" : result.error);
      return;
    }
    case "SUPPLIER_RESERVATION": {
      const { notifySuppliersOfReservation } = await import("@/lib/xml/reservation");
      await notifySuppliersOfReservation(payload as z.infer<typeof schemas.SUPPLIER_RESERVATION>);
      return;
    }
    case "NEWSLETTER_SYNC": {
      const { syncNewsletterSubscriberToResend } = await import("@/lib/email/resend-marketing");
      await syncNewsletterSubscriberToResend((payload as z.infer<typeof schemas.NEWSLETTER_SYNC>).email);
      return;
    }
    case "MARKETING_SYNC": {
      const { syncUserMarketingConsentToResend } = await import("@/lib/email/resend-marketing");
      await syncUserMarketingConsentToResend((payload as z.infer<typeof schemas.MARKETING_SYNC>).userId);
      return;
    }
    case "RESEND_CONTACT_UNSUBSCRIBE": {
      const { syncResendContact } = await import("@/lib/email/resend-marketing");
      const email = (payload as z.infer<typeof schemas.RESEND_CONTACT_UNSUBSCRIBE>).email;
      const result = await syncResendContact({
        email,
        unsubscribed: true,
        promotionalAudience: false,
        source: "account-deletion",
      });
      if (!result.ok) throw new Error(result.error);
      return;
    }
    case "FISCAL_RECEIPT": {
      const { issueAndDeliverFiscalReceipt } = await import("@/lib/fiscal");
      const args = payload as z.infer<typeof schemas.FISCAL_RECEIPT>;
      const result = await issueAndDeliverFiscalReceipt(args.orderId, {
        source: args.source,
        paymentMethod: args.paymentMethod,
      });
      if (!result.outcome.ok) throw new Error(result.outcome.error ?? result.outcome.reason);
      if (result.emailError) throw new Error(result.emailError);
      return;
    }
    case "ORDER_STATUS_EMAIL": {
      const { loadOrderForEmail, sendOrderStatusChanged } = await import("@/lib/email");
      const loaded = await loadOrderForEmail((payload as z.infer<typeof schemas.ORDER_STATUS_EMAIL>).orderId);
      if (!loaded?.recipient) return;
      const result = await sendOrderStatusChanged({
        order: loaded.order,
        status: loaded.order.status,
        to: loaded.recipient,
      });
      if (!result.ok) throw new Error(result.error);
      return;
    }
    case "IPS_PAYMENT_EMAIL": {
      const { loadOrderForEmail, sendIpsPaymentConfirmation } = await import("@/lib/email");
      const loaded = await loadOrderForEmail((payload as z.infer<typeof schemas.IPS_PAYMENT_EMAIL>).orderId);
      if (!loaded?.recipient) return;
      const result = await sendIpsPaymentConfirmation({ order: loaded.order, to: loaded.recipient });
      if (!result.ok) throw new Error(result.error);
      return;
    }
    case "RECLAMATION_RECEIPT": {
      const { loadReclamationForEmail, sendReclamationReceipt } = await import("@/lib/email");
      const loaded = await loadReclamationForEmail((payload as z.infer<typeof schemas.RECLAMATION_RECEIPT>).reclamationId);
      if (!loaded?.recipient) return;
      const result = await sendReclamationReceipt({ reclamation: loaded.reclamation, to: loaded.recipient });
      if (!result.ok) throw new Error(result.error);
      return;
    }
    case "RECLAMATION_STATUS_EMAIL": {
      const { loadReclamationForEmail, sendReclamationStatusChanged } = await import("@/lib/email");
      const loaded = await loadReclamationForEmail((payload as z.infer<typeof schemas.RECLAMATION_STATUS_EMAIL>).reclamationId);
      if (!loaded?.recipient) return;
      const result = await sendReclamationStatusChanged({
        reclamation: loaded.reclamation,
        status: loaded.reclamation.status,
        to: loaded.recipient,
      });
      if (!result.ok) throw new Error(result.error);
      return;
    }
    case "RABALUX_MEDIA_PRODUCT": {
      const { mirrorRabaluxProductMedia } = await import("@/lib/rabalux/media");
      const args = payload as z.infer<typeof schemas.RABALUX_MEDIA_PRODUCT>;
      await mirrorRabaluxProductMedia(
        args.productId,
        args.assetId && args.assetType
          ? { assetId: args.assetId, assetType: args.assetType }
          : undefined,
      );
      return;
    }
    case "SUPPLIER_ORDER_EMAIL": {
      const { sendSupplierOrderEmail } = await import("@/lib/rabalux/fulfillment");
      await sendSupplierOrderEmail(
        payload as z.infer<typeof schemas.SUPPLIER_ORDER_EMAIL>,
      );
      return;
    }
    case "SUPPLIER_CANCEL_EMAIL": {
      const { sendSupplierCancellationEmail } = await import(
        "@/lib/rabalux/fulfillment"
      );
      await sendSupplierCancellationEmail(
        (payload as z.infer<typeof schemas.SUPPLIER_CANCEL_EMAIL>).fulfillmentId,
      );
      return;
    }
    case "SUPPLIER_RECLAMATION_EMAIL": {
      const { sendSupplierReclamationEmail } = await import(
        "@/lib/rabalux/fulfillment"
      );
      await sendSupplierReclamationEmail(
        (payload as z.infer<typeof schemas.SUPPLIER_RECLAMATION_EMAIL>)
          .reclamationId,
      );
      return;
    }
  }
}

function safeError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return redactText(message.replace(/[\r\n\t]+/g, " "));
}
