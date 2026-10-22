import "server-only";
import { isUnpaidCodReturn } from "./reclamation-refund";
import type { Prisma, Reclamation } from "@prisma/client";

export function needsReclamationRefundNotice(claim: Pick<Reclamation, "decision" | "resolution" | "status">) {
  return claim.decision === "PRIHVACENA" && claim.resolution === "POVRAT_NOVCA"
    && claim.status !== "ODBIJENO" && claim.status !== "RESENO";
}

export const reclamationRefundNoticeKey = (id: string) => `reclamation-refund-support:${id}`;

export function reclamationReturnReceiptsWhere(id: string): Prisma.StockMovementWhereInput {
  const key = `reclamation-return:${id}`;
  return { OR: [{ idempotencyKey: key }, { idempotencyKey: { startsWith: `${key}:parcel:` } }] };
}

/** Call in the transaction that receives the goods or saves the refund decision. */
export async function queueReclamationRefundNotice(tx: Prisma.TransactionClient, reclamationId: string) {
  const claim = await tx.reclamation.findUnique({
    where: { id: reclamationId }, select: { decision: true, resolution: true, status: true, quantity: true, order: { select: { paymentMethod: true, courierPaidAt: true, payments: { select: { status: true } }, shipments: { where: { purpose: "ORDER_DELIVERY" }, select: { purpose: true, status: true, deliveredAt: true } } } } },
  });
  if (!claim || !needsReclamationRefundNotice(claim) || isUnpaidCodReturn(claim.order)) return null;
  // READY can also mean a replacement was prepared; only the stock receipt proves return intake.
  const receipts = await tx.stockMovement.findMany({
    where: reclamationReturnReceiptsWhere(reclamationId), select: { id: true, qty: true },
  });
  if (claim.quantity <= 0 || receipts.reduce((sum, row) => sum + row.qty, 0) < claim.quantity) return null;
  const idempotencyKey = reclamationRefundNoticeKey(reclamationId);
  const payload = { reclamationId };
  // ON CONFLICT avoids aborting a PostgreSQL transaction on a repeated intake/save.
  await tx.backgroundJob.createMany({
    data: { kind: "RECLAMATION_REFUND_OFFICE_EMAIL", payload, idempotencyKey }, skipDuplicates: true,
  });
  const job = await tx.backgroundJob.findUnique({ where: { idempotencyKey }, select: { id: true, status: true } });
  if (job?.status === "COMPLETED") {
    const sent = await tx.emailMessage.findUnique({
      where: { idempotencyKey }, select: { providerMessageId: true, status: true },
    });
    if (sent?.providerMessageId && ["SENT", "DELIVERED", "OPENED", "CLICKED", "BOUNCED", "COMPLAINED"].includes(sent.status)) return null;
    // A worker can skip a refund decision withdrawn before sending. A later refund approval re-arms it.
    await tx.backgroundJob.updateMany({
      where: { id: job.id, status: "COMPLETED" },
      data: { status: "QUEUED", payload, attempts: 0, availableAt: new Date(), completedAt: null, lastError: null },
    });
  }
  return job?.id ?? null;
}

export const reclamationFiscalRefundKey = (id: string) => `reclamation-fiscal-refund:${id}`;

/** Persist with stock/decision changes. No external fiscal request runs in that transaction. */
export async function queueReclamationFiscalRefund(tx: Prisma.TransactionClient, reclamationId: string) {
  const claim = await tx.reclamation.findUnique({
    where: { id: reclamationId },
    select: { decision: true, resolution: true, status: true, quantity: true, orderItemId: true, order: { select: { channel: true } } },
  });
  if (!claim || !needsReclamationRefundNotice(claim) || !claim.orderItemId || claim.order.channel === "ANANAS") return null;
  const receipts = await tx.stockMovement.findMany({ where: reclamationReturnReceiptsWhere(reclamationId), select: { qty: true } });
  if (claim.quantity <= 0 || receipts.reduce((sum, row) => sum + row.qty, 0) < claim.quantity) return null;
  const idempotencyKey = reclamationFiscalRefundKey(reclamationId);
  await tx.backgroundJob.createMany({ data: { kind: "RECLAMATION_FISCAL_REFUND", payload: { reclamationId }, idempotencyKey }, skipDuplicates: true });
  const job = await tx.backgroundJob.findUnique({ where: { idempotencyKey }, select: { id: true, status: true } });
  if (job?.status === "COMPLETED") return null;
  if (job?.status === "FAILED") {
    await tx.backgroundJob.updateMany({ where: { id: job.id, status: "FAILED" }, data: { status: "QUEUED", attempts: 0, availableAt: new Date(), lastError: null } });
  }
  return job?.id ?? null;
}
