import "server-only";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { syncAnanasDocuments } from "./sync";
import { ANANAS_INVENTORY_KEY, getAnanasInventoryPolicy, postPendingAnanasInventory } from "./inventory.server";
import { ANANAS_INVENTORY_START } from "./inventory-plan";

// API windows and stock transactions are individually resumable. A lease prevents
// the browser and cron advancing the same history interval concurrently.
export async function advanceAnanasInventoryHistory(actorId?: string, now = new Date()) {
  const started = Date.now(), token = randomUUID();
  const policy = await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('ananas-inventory-policy'))::text`;
    const current = await getAnanasInventoryPolicy(tx);
    if (!current?.enabled) throw new Error("Ananas knjiženje nije uključeno.");
    if (current.leaseUntil && new Date(current.leaseUntil).getTime() > Date.now()) throw new Error("Ananas istorija se već obrađuje. Sačekajte završetak.");
    // Rescan once after changing provider identity from invoiceId to fiscal number.
    // Earlier corrections sharing invoiceId may have been omitted. Existing posted
    // fiscal documents keep their ids and movements, so the rescan cannot repost them.
    const effective = current.documentIdentityVersion === 2 ? current : {
      ...current, historyThrough: ANANAS_INVENTORY_START, documentIdentityVersion: 2 as const,
    };
    await tx.adminSetting.update({ where: { key: ANANAS_INVENTORY_KEY }, data: { value: { ...effective, leaseToken: token, leaseUntil: new Date(Date.now() + 360000).toISOString() } } });
    return effective;
  });
  let imported = 0;
  try {
    const before = await postPendingAnanasInventory(40, actorId, started + 90000, new Date(policy.historyThrough) >= now);
    const waiting = await db.ananasDocument.count({ where: { inventoryPostedAt: null, inventoryError: null, issuedAt: { gte: new Date("2025-05-31T22:00:00.000Z") } } });
    let through = policy.historyThrough;
    // A source sync has its own 180s API + 90s storage bounds. If draining
    // inventory used time, fetch the next interval in a fresh invocation.
    if (!waiting && Date.now() - started < 20000 && new Date(through) < now) {
      const hours = policy.historyWindowHours ?? 72;
      const from = new Date(through), to = new Date(Math.min(now.getTime(), from.getTime() + hours * 3600000));
      try {
        imported = (await syncAnanasDocuments(from, to, "INVENTORY_HISTORY")).count;
      } catch (error) {
        // A provider timeout leaves the checkpoint intact. Shorten only the next
        // request, rather than stacking several 180-second attempts in one run.
        if (error instanceof Error && error.message.includes("predviđenom roku") && hours > 1) {
          const smaller = hours === 72 ? 24 : hours === 24 ? 6 : 1;
          await db.$transaction(async tx => {
            await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('ananas-inventory-policy'))::text`;
            const setting = await tx.adminSetting.findUniqueOrThrow({ where: { key: ANANAS_INVENTORY_KEY } });
            const value = setting.value as Record<string, unknown>;
            if (value.leaseToken === token) await tx.adminSetting.update({ where: { key: ANANAS_INVENTORY_KEY }, data: { value: { ...value, historyWindowHours: smaller } } });
          });
          throw new Error(`Ananas API nije odgovorio na vreme. Sledeći pokušaj koristi period od ${smaller} sati, sa istog mesta.`);
        }
        throw error;
      }
      through = to.toISOString();
    }
    const after = await postPendingAnanasInventory(40, actorId, started + 210000, new Date(through) >= now);
    await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('ananas-inventory-policy'))::text`;
      const current = await tx.adminSetting.findUniqueOrThrow({ where: { key: ANANAS_INVENTORY_KEY } });
      const value = current.value as Record<string, unknown>;
      if (value.leaseToken !== token) throw new Error("Ananas istorija je izgubila zaključavanje. Ponovite obradu.");
      await tx.adminSetting.update({ where: { key: ANANAS_INVENTORY_KEY }, data: { value: { ...value, historyThrough: through, leaseUntil: new Date(0).toISOString() } } });
    });
    const remaining = await db.ananasDocument.count({ where: { inventoryPostedAt: null, issuedAt: { gte: new Date("2025-05-31T22:00:00.000Z") } } });
    const errors = await db.ananasDocument.count({ where: { inventoryPostedAt: null, inventoryError: { not: null }, issuedAt: { gte: new Date("2025-05-31T22:00:00.000Z") } } });
    const [postedTotal, negatives] = await Promise.all([
      db.ananasDocument.count({ where: { inventoryPostedAt: { not: null }, issuedAt: { gte: new Date("2025-05-31T22:00:00.000Z") } } }),
      db.warehouseStock.count({ where: { warehouseId: policy.warehouseId, qty: { lt: 0 } } }),
    ]);
    return { imported, posted: before.posted + after.posted, failed: before.failed + after.failed, through,
      postedTotal, pendingTotal: remaining, negatives,
      complete: new Date(through) >= now && remaining === 0, needsReview: new Date(through) >= now && remaining > 0 && remaining === errors && before.posted + after.posted === 0 };
  } finally {
    await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('ananas-inventory-policy'))::text`;
      const setting = await tx.adminSetting.findUnique({ where: { key: ANANAS_INVENTORY_KEY } });
      const value = setting?.value as Record<string, unknown> | undefined;
      if (value?.leaseToken === token) await tx.adminSetting.update({ where: { key: ANANAS_INVENTORY_KEY }, data: { value: { ...value, leaseUntil: new Date(0).toISOString() } } });
    });
  }
}
