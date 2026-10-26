import "server-only";

import { PaymentStatus, Prisma } from "@prisma/client";
import { enqueueManualPaymentConfirmation } from "@/lib/payments/payment-confirmation.server";
import { providerForPaymentMethod } from "@/lib/payments/types";
import type { ManualSalesOrderInput } from "./sales-order";

export async function setManualSalesOrderPayment(
  tx: Prisma.TransactionClient,
  args: {
    orderId: string;
    orderNumber: string;
    paymentMethod: ManualSalesOrderInput["paymentMethod"];
    paid: boolean;
    amount: number;
    currency: string;
  },
) {
  // Share the bank import's order lock, so two saves or a bank import cannot
  // both observe the same unpaid receipt and queue two confirmations.
  await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Order" WHERE "id" = ${args.orderId} FOR UPDATE`);
  const previous = await tx.payment.findFirst({
    where: { orderId: args.orderId },
    orderBy: { createdAt: "desc" },
  });
  const data = {
    amount: new Prisma.Decimal(args.amount.toFixed(2)),
    currency: args.currency,
    method: args.paymentMethod,
    provider: providerForPaymentMethod(args.paymentMethod),
    status: args.paid ? PaymentStatus.PAID : PaymentStatus.PENDING,
    paidAt: args.paid ? previous?.paidAt ?? new Date() : null,
  };
  const payment = previous
    ? await tx.payment.update({ where: { id: previous.id }, data, select: { id: true } })
    : await tx.payment.create({ data: { ...data, orderId: args.orderId }, select: { id: true } });

  const bankReceipt = previous?.rawResponse && typeof previous.rawResponse === "object" &&
    !Array.isArray(previous.rawResponse) && "bankAccount" in previous.rawResponse &&
    /^FT[A-Z0-9]{8,30}$/.test(previous.providerRef ?? "");
  const alreadyPaid = previous?.paidAt || (previous &&
    ([PaymentStatus.PAID, PaymentStatus.REFUNDED, PaymentStatus.PARTIAL_REFUND] as PaymentStatus[]).includes(previous.status));
  if (!args.paid || args.paymentMethod !== "UPLATA_NA_RACUN" ||
    data.provider !== "MANUAL" || alreadyPaid || bankReceipt || !data.amount.gt(0)) return;

  await enqueueManualPaymentConfirmation(tx, {
    orderId: args.orderId, orderNumber: args.orderNumber, paymentId: payment.id,
    amount: data.amount, currency: args.currency,
  });
}
