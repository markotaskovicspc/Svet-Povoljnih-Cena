import "server-only";

import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { enqueueManualPaymentConfirmation } from "@/lib/payments/payment-confirmation.server";

export async function confirmWebOrderBankTransfer(input: {
  orderId: string;
  paymentId: string;
  paidAt: Date;
  statementReference: string;
  note: string;
  actorId: string;
}) {
  const { orderId, paymentId, paidAt, statementReference, note, actorId } = input;
  return db.$transaction(async (tx) => {
    await tx.$queryRaw(Prisma.sql`
      SELECT "id" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE
    `);
    const order = await tx.order.findUnique({
      where: { id: orderId },
      select: { id: true, number: true, status: true, paymentMethod: true, cancelledAt: true },
    });
    if (!order || order.paymentMethod !== "UPLATA_NA_RACUN") {
      throw new Error("Porudžbina sa uplatom na račun nije pronađena.");
    }
    if (order.cancelledAt || order.status === "OTKAZANO") {
      throw new Error("Uplata se ne potvrđuje na otkazanoj porudžbini.");
    }
    const payment = await tx.payment.findFirst({
      where: { id: paymentId, orderId, method: "UPLATA_NA_RACUN", provider: "MANUAL" },
      select: { id: true, status: true, amount: true, currency: true },
    });
    if (!payment) throw new Error("Evidencija uplate nije pronađena.");
    if (payment.status !== "PENDING") {
      throw new Error(payment.status === "PAID"
        ? "Ova uplata je već potvrđena."
        : `Uplata je u statusu ${payment.status} i ne može ručno da se potvrdi.`);
    }
    const updated = await tx.payment.updateMany({
      where: { id: payment.id, status: "PENDING" },
      data: { status: "PAID", paidAt, providerRef: statementReference.slice(0, 180) },
    });
    if (updated.count !== 1) {
      throw new Error("Status uplate je u međuvremenu promenjen. Osvežite stranicu.");
    }
    const eventNote = [
      `Uplata na račun potvrđena (${payment.amount} ${payment.currency}; ref. ${statementReference.slice(0, 180)}).`,
      note ? note.slice(0, 500) : null,
    ].filter(Boolean).join(" ");
    await tx.orderStatusEvent.create({
      data: { orderId, status: order.status, actorId, note: eventNote },
    });
    await enqueueManualPaymentConfirmation(tx, {
      orderId, orderNumber: order.number, paymentId: payment.id,
      amount: payment.amount, currency: payment.currency,
    });
    return { orderNumber: order.number, amount: Number(payment.amount), currency: payment.currency };
  });
}
