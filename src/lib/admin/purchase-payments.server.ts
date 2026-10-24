import "server-only";
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";

const money = z.string().regex(/^\d{1,10}(?:\.\d{1,2})?$/, "Unesite iznos sa najviše dve decimale.")
  .refine((value) => new Prisma.Decimal(value).gt(0), "Iznos mora biti veći od nule.");
export const paymentInputSchema = z.object({
  id: z.uuid(), purchaseOrderId: z.string().min(1), paidAt: z.iso.date(),
  amount: money, amountRsd: money, notes: z.string().trim().max(2000).default(""),
});

export type PaymentSnapshot = {
  version: 1; purchaseOrderId: string; capturedAt: string; currency: string;
  payments: Array<{ id: string; paidAt: string; amount: string; amountRsd: string; notes: string | null }>;
  totalAmount: string; totalRsd: string;
};
export type PaymentSummary = {
  version: string; count: number; totalAmount: string; totalRsd: string;
};

type PaymentRow = {
  id: string; paidAt: Date; currency: string; amount: Prisma.Decimal;
  amountRsd: Prisma.Decimal; notes: string | null; voidedAt: Date | null;
};

export function summarizePurchasePayments(rows: PaymentRow[]): PaymentSummary {
  const active = rows.filter((row) => !row.voidedAt).sort((a, b) => a.id.localeCompare(b.id));
  return {
    count: active.length,
    totalAmount: active.reduce((sum, row) => sum.add(row.amount), new Prisma.Decimal(0)).toFixed(2),
    totalRsd: active.reduce((sum, row) => sum.add(row.amountRsd), new Prisma.Decimal(0)).toFixed(2),
    version: createHash("sha256").update(JSON.stringify(active.map((row) => [
      row.id, row.paidAt.toISOString(), row.currency, row.amount.toFixed(2),
      row.amountRsd.toFixed(2), row.notes,
    ]))).digest("hex"),
  };
}

export async function capturePaymentSnapshot(purchaseOrderId: string, expectedVersion: string) {
  const order = await db.purchaseOrder.findUniqueOrThrow({
    where: { id: purchaseOrderId }, include: { payments: { orderBy: [{ paidAt: "asc" }, { id: "asc" }] } },
  });
  const summary = summarizePurchasePayments(order.payments);
  if (!summary.count || summary.version !== expectedVersion) {
    throw new Error("Uplate su promenjene. Osvežite prijemnicu i ponovo preuzmite zbir uplata.");
  }
  const snapshot: PaymentSnapshot = {
    version: 1, purchaseOrderId, capturedAt: new Date().toISOString(), currency: order.currency,
    payments: order.payments.filter((row) => !row.voidedAt).map((row) => ({
      id: row.id, paidAt: row.paidAt.toISOString().slice(0, 10),
      amount: row.amount.toFixed(2), amountRsd: row.amountRsd.toFixed(2), notes: row.notes,
    })),
    totalAmount: summary.totalAmount, totalRsd: summary.totalRsd,
  };
  return snapshot;
}

export async function recordPurchasePayment(input: unknown, actorId: string) {
  const data = paymentInputSchema.parse(input);
  return db.$transaction(async (tx) => {
    // Updating the timestamp takes the row lock using the adapter's configured
    // schema, and serializes retries without changing the locked business data.
    const order = await tx.purchaseOrder.update({
      where: { id: data.purchaseOrderId }, data: { updatedAt: new Date() },
      select: { id: true, status: true, currency: true },
    });
    if (order.status === "CANCELLED") throw new Error("Otkazana porudžbenica ne prima nove uplate.");
    const amount = new Prisma.Decimal(data.amount);
    const amountRsd = order.currency === "RSD" ? amount : new Prisma.Decimal(data.amountRsd);
    const existing = await tx.purchaseOrderPayment.findUnique({ where: { id: data.id } });
    if (existing) {
      if (existing.purchaseOrderId === order.id && !existing.voidedAt &&
          existing.amount.eq(amount) && existing.amountRsd.eq(amountRsd) &&
          existing.paidAt.toISOString().slice(0, 10) === data.paidAt &&
          existing.notes === (data.notes || null)) return existing;
      throw new Error("Ovaj zahtev je već obrađen. Osvežite stranicu pre novog unosa.");
    }
    return tx.purchaseOrderPayment.create({ data: {
      id: data.id, purchaseOrderId: order.id, paidAt: new Date(data.paidAt + "T00:00:00.000Z"),
      currency: order.currency, amount, amountRsd, notes: data.notes || null, actorId,
    } });
  });
}

export async function voidPurchasePayment(purchaseOrderId: string, paymentId: string) {
  return db.purchaseOrderPayment.updateMany({
    where: { id: paymentId, purchaseOrderId, voidedAt: null },
    data: { voidedAt: new Date() },
  });
}
