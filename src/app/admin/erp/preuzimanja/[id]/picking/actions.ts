"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { withAdminState } from "@/lib/admin";
import { getPickingSession } from "@/lib/admin/picking.server";
import { validatePickingDelta } from "@/lib/admin/picking-plan";
const schema = z.object({ id: z.string().uuid(), batchId: z.string().min(1), planHash: z.string().length(64), rowKey: z.string().min(1).max(500), delta: z.number().int().min(-10000).max(10000), note: z.string().max(1000) });
export async function recordPicking(input: z.infer<typeof schema>) {
  return withAdminState({ allowed: ["OPS"], action: "picking.scan", entity: "PickupBatch" }, async actorId => {
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
    return { ok: true, entityId: data.batchId, diff: data, result, message: data.delta ? "Količina je evidentirana." : "Napomena je sačuvana." };
  })();
}
