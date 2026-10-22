import "server-only";

import type { ReclamationStatus } from "@prisma/client";
import { enqueueBackgroundJob } from "@/lib/background-jobs";
import { db } from "@/lib/db";
import { lockOrderReturn } from "@/lib/fiscal/return-lock";

export async function updateReclamationStatus(args: {
  reclamationId: string;
  status: ReclamationStatus;
  note?: string | null;
  actorId?: string | null;
}) {
  return db.$transaction(async (tx) => {
    const claim = await tx.reclamation.findUnique({ where: { id: args.reclamationId }, select: { orderId: true } });
    if (!claim) throw new Error("Reklamacija nije pronađena.");
    await lockOrderReturn(tx, claim.orderId);
    if (args.status === "RESENO" || args.status === "ODBIJENO") {
      const payout = await tx.paymentRefund.findUnique({ where: { idempotencyKey: `reclamation-refund:${args.reclamationId}` }, select: { status: true } });
      if (payout && payout.status !== "COMPLETED") throw new Error("Povrat novca je započet. Prvo završite fiskalnu refundaciju i potvrdite izvršenu uplatu u odeljku Povrat novca na račun kupca.");
    }
    const resolved = args.status === "RESENO" || args.status === "ODBIJENO";
    await tx.reclamation.update({
      where: { id: args.reclamationId },
      data: {
        status: args.status,
        resolvedAt: resolved ? new Date() : null,
      },
    });
    const event = await tx.reclamationStatusEvent.create({
      data: {
        reclamationId: args.reclamationId,
        status: args.status,
        note: args.note ?? null,
        actorId: args.actorId ?? null,
      },
      select: { id: true },
    });
    await enqueueBackgroundJob(
      {
        kind: "RECLAMATION_STATUS_EMAIL",
        payload: { reclamationId: args.reclamationId, eventId: event.id },
        idempotencyKey: `reclamation-status-email:${event.id}`,
      },
      tx,
    );
    return event;
  });
}
