import "server-only";

import type { ReclamationStatus } from "@prisma/client";
import { enqueueBackgroundJob } from "@/lib/background-jobs";
import { db } from "@/lib/db";

export async function updateReclamationStatus(args: {
  reclamationId: string;
  status: ReclamationStatus;
  note?: string | null;
  actorId?: string | null;
}) {
  return db.$transaction(async (tx) => {
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
