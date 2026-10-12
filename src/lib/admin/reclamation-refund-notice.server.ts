import "server-only";
import type { Prisma, Reclamation } from "@prisma/client";

export function needsReclamationRefundNotice(claim: Pick<Reclamation, "decision" | "resolution" | "status">) {
  return claim.decision === "PRIHVACENA" && claim.resolution === "POVRAT_NOVCA"
    && claim.status !== "ODBIJENO" && claim.status !== "RESENO";
}

export const reclamationRefundNoticeKey = (id: string) => `reclamation-refund-office:${id}`;

export function reclamationReturnReceiptsWhere(id: string): Prisma.StockMovementWhereInput {
  const key = `reclamation-return:${id}`;
  return { OR: [{ idempotencyKey: key }, { idempotencyKey: { startsWith: `${key}:parcel:` } }] };
}

/** Call in the transaction that receives the goods or saves the refund decision. */
export async function queueReclamationRefundNotice(tx: Prisma.TransactionClient, reclamationId: string) {
  const claim = await tx.reclamation.findUnique({
    where: { id: reclamationId }, select: { decision: true, resolution: true, status: true, quantity: true },
  });
  if (!claim || !needsReclamationRefundNotice(claim)) return null;
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
