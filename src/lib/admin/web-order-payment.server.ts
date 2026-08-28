import "server-only";

import { randomUUID } from "node:crypto";
import { Prisma, type PaymentMethod } from "@prisma/client";
import { db } from "@/lib/db";
import {
  enqueueBackgroundJob,
  processBackgroundJob,
} from "@/lib/background-jobs";
import { isPaymentMethodEnabled } from "@/lib/checkout/config";
import { issueBuyerReceiptForOrder } from "@/lib/receipts";
import { providerForPaymentMethod } from "@/lib/payments";
import { adminPaymentMethodLabel } from "@/lib/payments/admin-display";
import {
  supplierOrderIdempotencyKey,
  supplierShippingDocumentsIdempotencyKey,
} from "@/lib/rabalux/messages";
import { planWebOrderPaymentMethodChange } from "./web-order-payment";

const EDITABLE_WEB_ORDER_STATUSES = [
  "KREIRANO",
  "POTVRDJENO",
  "U_PRIPREMI",
] as const;

type LockedBackgroundJob = {
  id: string;
  kind: string;
  status: string;
};

function hasText(value: string | null) {
  return Boolean(value?.trim());
}

async function refreshBuyerReceipt(orderId: string) {
  let receiptRefreshed = false;
  let receiptError: string | null = null;
  try {
    const receipt = await issueBuyerReceiptForOrder(orderId, {
      sendEmail: false,
      invalidateExistingPdfOnUploadFailure: true,
    });
    receiptRefreshed = receipt.ok;
    receiptError = receipt.ok ? null : receipt.error;
    if (receipt.ok) {
      await db.invoice.update({
        where: { id: receipt.invoiceId },
        data: {
          status: "ISSUED",
          emailedAt: null,
          emailError: null,
        },
      });
    }
  } catch (error) {
    receiptError =
      error instanceof Error ? error.message : "Predračun nije osvežen.";
  }
  return { receiptRefreshed, receiptError };
}

export async function updateWebOrderPaymentMethod(input: {
  orderId: string;
  nextMethod: PaymentMethod;
  actorId: string;
}) {
  if (!input.orderId) throw new Error("Nedostaje WEB porudžbina.");
  if (!(await isPaymentMethodEnabled(input.nextMethod))) {
    throw new Error("Izabrani način plaćanja trenutno nije uključen u prodavnici.");
  }

  const operationKey = randomUUID();
  const result = await db.$transaction(
    async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "Order" WHERE "id" = ${input.orderId} FOR UPDATE`,
      );
      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "Payment" WHERE "orderId" = ${input.orderId} ORDER BY "id" FOR UPDATE`,
      );
      const fulfillmentRows = await tx.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`
          SELECT "id"
          FROM "SupplierFulfillment"
          WHERE "orderId" = ${input.orderId}
          ORDER BY "id"
          FOR UPDATE
        `,
      );
      const exactJobKeys = [
        `buyer-receipt:${input.orderId}`,
        `fiscal-advance:${input.orderId}`,
        `fiscal-pickup:${input.orderId}`,
      ];
      const exactJobs = await tx.$queryRaw<LockedBackgroundJob[]>(Prisma.sql`
        SELECT "id", "kind", "status"
        FROM "BackgroundJob"
        WHERE "idempotencyKey" IN (${Prisma.join(exactJobKeys)})
        ORDER BY "id"
        FOR UPDATE
      `);
      const fulfillmentIds = fulfillmentRows.map((row) => row.id);
      const supplierJobs = fulfillmentIds.length
        ? await tx.$queryRaw<LockedBackgroundJob[]>(Prisma.sql`
            SELECT "id", "kind", "status"
            FROM "BackgroundJob"
            WHERE "kind" IN ('SUPPLIER_ORDER_EMAIL', 'SUPPLIER_SHIPPING_DOCUMENTS_EMAIL')
              AND "payload"->>'fulfillmentId' IN (${Prisma.join(fulfillmentIds)})
            ORDER BY "id"
            FOR UPDATE
          `)
        : [];

      if (
        exactJobs.some(
          (job) => job.kind === "BUYER_RECEIPT" && job.status === "RUNNING",
        )
      ) {
        throw new Error(
          "Predračun se upravo obrađuje. Sačekajte završetak i pokušajte ponovo.",
        );
      }
      if (
        exactJobs.some(
          (job) =>
            job.kind === "FISCAL_RECEIPT" &&
            ["QUEUED", "RETRY", "RUNNING"].includes(job.status),
        )
      ) {
        throw new Error(
          "Fiskalizacija je već zakazana ili je u toku; način plaćanja više ne može da se promeni.",
        );
      }

      const order = await tx.order.findUnique({
        where: { id: input.orderId },
        include: {
          payments: { orderBy: { createdAt: "desc" } },
          paymentRefunds: { select: { id: true } },
          fiscal: { select: { id: true } },
          fiscalDocuments: {
            where: { kind: "SALE" },
            select: { id: true },
          },
          shipments: {
            where: {
              purpose: "ORDER_DELIVERY",
              status: { not: "FAILED" },
            },
            select: { id: true },
          },
          dispatchNotes: {
            where: { status: { not: "CANCELLED" } },
            select: { id: true },
          },
          pickupBatchLines: {
            where: { batch: { status: { not: "CANCELLED" } } },
            select: { id: true },
          },
          reclamations: { select: { id: true } },
          items: {
            select: {
              id: true,
              warehouseDispatchedQty: true,
              dispatchNoteItems: {
                where: { dispatchNote: { status: { not: "CANCELLED" } } },
                select: { id: true },
              },
              pickupBatchLines: {
                where: { batch: { status: { not: "CANCELLED" } } },
                select: { id: true },
              },
            },
          },
          supplierFulfillments: {
            include: {
              supplier: { select: { integrationKey: true } },
              items: { select: { orderItemId: true } },
            },
          },
        },
      });
      if (!order) throw new Error("WEB porudžbina nije pronađena.");
      if (order.channel !== "WEB") {
        throw new Error("Ova akcija je dostupna samo za WEB porudžbine.");
      }
      if (
        !EDITABLE_WEB_ORDER_STATUSES.includes(
          order.status as (typeof EDITABLE_WEB_ORDER_STATUSES)[number],
        )
      ) {
        throw new Error("Porudžbina u ovom statusu više ne može da se menja.");
      }
      if (order.stockRestoredAt || order.cancelledAt) {
        throw new Error("Otkazana ili vraćena porudžbina ne može da se menja.");
      }
      if (order.fiscal || order.fiscalDocuments.length) {
        throw new Error(
          "Fiskalizovana porudžbina ili fiskalni zahtev ne mogu da se menjaju.",
        );
      }
      if (order.shipments.length || order.pickupBatchLines.length) {
        throw new Error(
          "Porudžbina uključena u isporuku ili preuzimanje ne može da se menja.",
        );
      }
      if (
        order.dispatchNotes.length ||
        order.items.some(
          (item) =>
            item.warehouseDispatchedQty > 0 ||
            item.dispatchNoteItems.length > 0 ||
            item.pickupBatchLines.length > 0,
        )
      ) {
        throw new Error(
          "Porudžbina uključena u otpremnicu ili kurirsko preuzimanje ne može da se menja.",
        );
      }
      if (order.reclamations.length || order.paymentRefunds.length) {
        throw new Error(
          "Porudžbina sa reklamacijom ili povraćajem ne može da se menja.",
        );
      }
      if (!order.payments.length) {
        throw new Error(
          "Porudžbina nema evidentirano plaćanje; potrebna je ručna kontrola.",
        );
      }

      const activeRabaluxFulfillments = order.supplierFulfillments.filter(
        (fulfillment) =>
          fulfillment.supplier.integrationKey === "RABALUX" &&
          !["CANCELLED", "COMPLETED"].includes(fulfillment.status),
      );
      const rabaluxOrderItemIds = new Set(
        activeRabaluxFulfillments.flatMap((fulfillment) =>
          fulfillment.items.map((item) => item.orderItemId),
        ),
      );
      const plan = planWebOrderPaymentMethodChange({
        currentMethod: order.paymentMethod,
        nextMethod: input.nextMethod,
        businessBuyer: [
          order.shipCompanyName,
          order.shipPib,
          order.billCompanyName,
          order.billPib,
        ].some(hasText),
        mixedRabaluxOrder:
          rabaluxOrderItemIds.size > 0 &&
          order.items.some((item) => !rabaluxOrderItemIds.has(item.id)),
        attempts: order.payments.map((payment) => ({
          status: payment.status,
          providerRef: payment.providerRef,
          paymentReference: payment.paymentReference,
          redirectUrl: payment.redirectUrl,
          hasRawRequest: payment.rawRequest != null,
          hasRawResponse: payment.rawResponse != null,
        })),
      });

      if (
        plan.supplierReadinessChanged &&
        supplierJobs.some((job) => job.status === "RUNNING")
      ) {
        throw new Error(
          "Dobavljački nalog se upravo obrađuje. Sačekajte završetak i pokušajte ponovo.",
        );
      }

      const changedAt = new Date();
      await tx.payment.updateMany({
        where: { orderId: order.id, status: "PENDING" },
        data: {
          status: "FAILED",
          expiresAt: null,
          rawResponse: {
            reason: "admin_payment_method_changed",
            previousMethod: order.paymentMethod,
            nextMethod: input.nextMethod,
            changedAt: changedAt.toISOString(),
          },
        },
      });
      const payment = await tx.payment.create({
        data: {
          orderId: order.id,
          method: input.nextMethod,
          provider: providerForPaymentMethod(input.nextMethod),
          status: "PENDING",
          amount: order.total,
          currency: order.payments[0]?.currency ?? "RSD",
          expiresAt: null,
        },
        select: { id: true },
      });
      await tx.order.update({
        where: { id: order.id },
        data: { paymentMethod: input.nextMethod, expiresAt: null },
      });
      await tx.checkoutSession.updateMany({
        where: { orderId: order.id },
        data: { paymentMethod: input.nextMethod },
      });

      const supplierJobIds: string[] = [];
      if (plan.supplierReadinessChanged) {
        await tx.backgroundJob.updateMany({
          where: {
            id: { in: supplierJobs.map((job) => job.id) },
            status: { in: ["QUEUED", "RETRY"] },
          },
          data: {
            status: "COMPLETED",
            payload: {},
            lockedAt: null,
            completedAt: changedAt,
            lastError: null,
          },
        });
        const dispatchKey = `payment-change-${operationKey}`;
        for (const fulfillment of activeRabaluxFulfillments) {
          if (!plan.willBeCashOnDelivery && fulfillment.sentAt) continue;
          const kind = plan.willBeCashOnDelivery
            ? ("SUPPLIER_SHIPPING_DOCUMENTS_EMAIL" as const)
            : ("SUPPLIER_ORDER_EMAIL" as const);
          const job = await enqueueBackgroundJob(
            {
              kind,
              payload: { fulfillmentId: fulfillment.id, dispatchKey },
              idempotencyKey: plan.willBeCashOnDelivery
                ? supplierShippingDocumentsIdempotencyKey(
                    fulfillment.id,
                    dispatchKey,
                  )
                : supplierOrderIdempotencyKey(fulfillment.id, dispatchKey),
            },
            tx,
          );
          supplierJobIds.push(job.id);
        }
      }

      await tx.orderStatusEvent.create({
        data: {
          orderId: order.id,
          status: order.status,
          actorId: input.actorId,
          note: `Način plaćanja promenjen: ${adminPaymentMethodLabel(order.paymentMethod)} → ${adminPaymentMethodLabel(input.nextMethod)}.`,
        },
      });

      return {
        orderId: order.id,
        orderNumber: order.number,
        paymentId: payment.id,
        previousMethod: order.paymentMethod,
        nextMethod: input.nextMethod,
        invalidatedPaymentAttempts: plan.invalidatePendingAttempts,
        supplierJobIds,
      };
    },
    { maxWait: 10_000, timeout: 30_000 },
  );

  await Promise.allSettled(
    result.supplierJobIds.map((jobId) => processBackgroundJob(jobId)),
  );
  const receipt = await refreshBuyerReceipt(result.orderId);
  return {
    ...result,
    ...receipt,
    supplierJobsQueued: result.supplierJobIds.length,
  };
}
