"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { withAdminState } from "@/lib/admin";
import { getPickingSession } from "@/lib/admin/picking.server";
import { validatePickingDelta } from "@/lib/admin/picking-plan";
import { createHash } from "node:crypto";
import { pickingReview } from "@/lib/admin/picking-review";
const schema = z.object({ id: z.string().uuid(), batchId: z.string().min(1), planHash: z.string().length(64), rowKey: z.string().min(1).max(500), delta: z.number().int().min(-10000).max(10000), note: z.string().max(1000) });
export async function recordPicking(input: z.infer<typeof schema>) {
  return withAdminState({ allowed: ["OPS", "WAREHOUSE"], action: "picking.scan", entity: "PickupBatch" }, async actorId => {
    const data = schema.parse(input);
    const result = await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "PickupBatch" WHERE id = ${data.batchId} FOR UPDATE`;
      const previous = await tx.pickingScanEvent.findUnique({ where: { id: data.id } });
      if (previous) {
        if (previous.actorId !== actorId || previous.batchId !== data.batchId || previous.planHash !== data.planHash || previous.rowKey !== data.rowKey || previous.delta !== data.delta || previous.note !== data.note) throw new Error("Zahtev je već iskorišćen za drugo evidentiranje.");
        return getPickingSession(data.batchId, tx);
      }
      const session = await getPickingSession(data.batchId, tx);
      if (!session.editable) throw new Error("Nalog je zaključan za odvajanje robe.");
      if (session.planHash !== data.planHash) throw new Error("Sadržaj naloga je promenjen. Osvežite pregled i proverite robu ponovo.");
      const row = session.rows.find(r => r.key === data.rowKey);
      if (!row || row.sku === "—") throw new Error("Stavka nema važeći artikal. Ispravite nalog.");
      validatePickingDelta(session.progress[row.key] ?? 0, data.delta, row.quantity);
      if (data.delta === 0 && !data.note.trim()) throw new Error("Unesite napomenu o nedostatku robe.");
      await tx.pickingScanEvent.create({ data: { ...data, actorId } });
      return getPickingSession(data.batchId, tx);
    }, { timeout: 20000 });
    revalidatePath(`/admin/erp/preuzimanja/${data.batchId}/picking`);
    revalidatePath(`/admin/magacin/picking/${data.batchId}`);
    revalidatePath("/admin/magacin");
    return { ok: true, entityId: data.batchId, diff: data, result, message: data.delta ? "Količina je evidentirana." : "Napomena je sačuvana." };
  })();
}

const finishSchema = z.object({ batchId: z.string().min(1), planHash: z.string().length(64), mode: z.enum(["labels", "shortage"]), packagesConfirmed: z.boolean() });
export async function finishPicking(input: z.infer<typeof finishSchema>) {
  return withAdminState({ allowed: ["OPS", "WAREHOUSE"], action: "picking.finish", entity: "PickupBatch" }, async actorId => {
    const data = finishSchema.parse(input);
    const { enqueueBackgroundJob } = await import("@/lib/background-jobs");
    // The report and its queue entry share the same batch lock as scans/collection.
    const notification = await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "PickupBatch" WHERE id = ${data.batchId} FOR UPDATE`;
      const session = await getPickingSession(data.batchId, tx);
      if (session.planHash !== data.planHash) throw new Error("Sadržaj naloga je promenjen. Osvežite pregled.");
      const review = pickingReview(session);
      if (data.mode === "shortage" && (!session.editable || !review.reviewed || !review.shortages.length)) throw new Error("Prvo potvrdite količine svih artikala na nalogu.");
      if (data.mode === "labels" && (!review.complete || !data.packagesConfirmed)) throw new Error("Prvo odvojite sve artikle i potvrdite spakovane pakete.");
      const operationKey = createHash("sha256").update(JSON.stringify([data.batchId, session.planHash, data.mode, review.shortages])).digest("hex");
      const payload = { mode: data.mode, batchId: session.id, batchNumber: session.number, planHash: session.planHash, operationKey, shortages: review.shortages };
      if (data.mode === "shortage") {
        const idempotencyKey = `picking-shortage:${operationKey}`;
        const previous = await tx.backgroundJob.findUnique({ where: { idempotencyKey }, select: { id: true, status: true, lastError: true } });
        // Batch lock serializes reporters. Avoid a unique violation inside a PG transaction.
        if (!previous) await enqueueBackgroundJob({ kind: "WAREHOUSE_PICKING_EMAIL", payload, idempotencyKey }, tx);
        else if (previous.status === "FAILED" && !previous.lastError?.startsWith("[permanent]")) {
          await tx.backgroundJob.update({ where: { id: previous.id }, data: { status: "QUEUED", attempts: 0, availableAt: new Date(), lockedAt: null, completedAt: null, lastError: null } });
        }
      }
      return payload;
    }, { timeout: 20000 });
    if (data.mode === "labels") {
      const { prepareWarehousePickupLabels } = await import("@/lib/admin/pickup-batch.server");
      await prepareWarehousePickupLabels(data.batchId, actorId, data.planHash);
      await enqueueBackgroundJob({ kind: "WAREHOUSE_PICKING_EMAIL", payload: notification, idempotencyKey: `picking-labels:${notification.operationKey}` });
    }
    revalidatePath(`/admin/magacin/picking/${data.batchId}`);
    revalidatePath("/admin/magacin");
    revalidatePath(`/admin/erp/preuzimanja/${data.batchId}`);
    revalidatePath("/admin/erp/preuzimanja");
    return { ok: true, entityId: data.batchId, diff: { mode: data.mode, operationKey: notification.operationKey }, result: { labelUrl: data.mode === "labels" ? `/api/admin/erp/preuzimanja/${encodeURIComponent(data.batchId)}/labels` : null },
      message: data.mode === "labels" ? "Adresnice su spremne. PDF je u redu za slanje na magacin@svetpovoljnihcena.rs." : "Prijava manjka je sačuvana za slanje na podrska@svetpovoljnihcena.rs." };
  })();
}
