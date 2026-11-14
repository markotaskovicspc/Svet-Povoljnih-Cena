import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  isTransferPaid,
  shouldCancelUnpaidTransfer,
  unpaidTransferCancelKey,
  unpaidTransferReminderBefore,
  unpaidTransferReminderKey,
} from "./unpaid-transfer";

const unpaidWhere = (createdBefore: Date): Prisma.OrderWhereInput => ({
  channel: "WEB",
  paymentMethod: "UPLATA_NA_RACUN",
  status: "KREIRANO",
  cancelledAt: null,
  createdAt: { lte: createdBefore },
  payments: { none: { status: { in: ["PAID", "AUTHORIZED", "PARTIAL_REFUND"] } } },
  fiscal: { is: null },
  fiscalDocuments: { none: {} },
});

/** Pokreće se iz cron-a pozadinskih poslova; svaki posao jednom po porudžbini. */
export async function sweepUnpaidTransferOrders(now = new Date(), limit = 50) {
  const orders = await db.order.findMany({
    where: unpaidWhere(unpaidTransferReminderBefore(now)),
    select: { id: true, createdAt: true },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
  if (!orders.length) return { reminders: 0, cancellations: 0 };
  const reminders = await db.backgroundJob.createMany({
    data: orders.map((order) => ({
      kind: "UNPAID_TRANSFER_REMINDER_EMAIL",
      payload: { orderId: order.id },
      idempotencyKey: unpaidTransferReminderKey(order.id),
    })),
    skipDuplicates: true,
  });
  const sent = await db.backgroundJob.findMany({
    where: {
      idempotencyKey: { in: orders.map((order) => unpaidTransferReminderKey(order.id)) },
      status: "COMPLETED",
    },
    select: { idempotencyKey: true, completedAt: true },
  });
  const sentAt = new Map(sent.map((job) => [job.idempotencyKey, job.completedAt]));
  const due = orders.filter((order) =>
    shouldCancelUnpaidTransfer({
      createdAt: order.createdAt,
      reminderCompletedAt: sentAt.get(unpaidTransferReminderKey(order.id)) ?? null,
      now,
    }),
  );
  const cancellations = due.length
    ? await db.backgroundJob.createMany({
        data: due.map((order) => ({
          kind: "UNPAID_TRANSFER_AUTO_CANCEL",
          payload: { orderId: order.id },
          idempotencyKey: unpaidTransferCancelKey(order.id),
        })),
        skipDuplicates: true,
      })
    : { count: 0 };
  return { reminders: reminders.count, cancellations: cancellations.count };
}

async function stillUnpaid(orderId: string) {
  const order = await db.order.findFirst({
    where: { id: orderId, ...unpaidWhere(new Date()) },
    select: { id: true, payments: { select: { status: true } } },
  });
  return order && !isTransferPaid(order.payments.map((p) => p.status)) ? order : null;
}

export async function sendUnpaidTransferReminderJob(orderId: string) {
  if (!(await stillUnpaid(orderId))) return { skipped: "PAID_OR_CLOSED" as const };
  const { sendUnpaidTransferReminder } = await import("@/lib/email/unpaid-transfer");
  return sendUnpaidTransferReminder(orderId);
}

export async function autoCancelUnpaidTransferJob(orderId: string) {
  if (!(await stillUnpaid(orderId))) return { skipped: "PAID_OR_CLOSED" as const };
  const { cancelWebOrderByCustomer } = await import("./cancellation.server");
  const result = await cancelWebOrderByCustomer({ orderId, unpaidTransferTimeout: true });
  await db.auditLog.create({
    data: {
      action: "order.unpaid_transfer_auto_cancel",
      entity: "Order",
      entityId: orderId,
      diff: { orderNumber: result.orderNumber, alreadyCancelled: result.alreadyCancelled },
    },
  });
  return result;
}
