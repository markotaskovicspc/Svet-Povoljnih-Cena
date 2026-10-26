import "server-only";

import type { Prisma } from "@prisma/client";
import { enqueueBackgroundJob } from "@/lib/background-jobs";
import { manualPaymentConfirmationSchema } from "./payment-confirmation";

/** Call within the payment mutation while holding its shared Order row lock. */
export async function enqueueManualPaymentConfirmation(
  tx: Prisma.TransactionClient,
  receipt: {
    orderId: string;
    orderNumber: string;
    paymentId: string;
    amount: Prisma.Decimal;
    currency: string;
  },
) {
  if (!receipt.amount.gt(0)) return;
  const idempotencyKey = `bank-payment-email:manual:${receipt.paymentId}`;
  // Avoid the duplicate-insert/P2002 path inside the caller's transaction.
  // Every manual producer serializes this key with the same Order row lock.
  const existingJob = await tx.backgroundJob.findUnique({
    where: { idempotencyKey }, select: { id: true },
  });
  if (existingJob) return;
  await enqueueBackgroundJob({
    kind: "BANK_PAYMENT_EMAIL", idempotencyKey,
    payload: manualPaymentConfirmationSchema.parse({
      source: "MANUAL", orderId: receipt.orderId, orderNumber: receipt.orderNumber,
      paymentId: receipt.paymentId, amountMinor: receipt.amount.mul(100).toNumber(),
      currency: receipt.currency,
    }),
  }, tx);
}
