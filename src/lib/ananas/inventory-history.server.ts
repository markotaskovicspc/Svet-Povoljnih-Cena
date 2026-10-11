import "server-only";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { syncAnanasDocuments } from "./sync";
import { ANANAS_INVENTORY_KEY, getAnanasInventoryPolicy, postPendingAnanasInventory } from "./inventory.server";

// API windows and stock transactions are individually resumable. A lease prevents
// the browser and cron advancing the same history interval concurrently.
export async function advanceAnanasInventoryHistory(actorId?: string, now = new Date()) {
  const started = Date.now(), token = randomUUID();
  const policy = await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('ananas-inventory-policy'))::text`;
    const current = await getAnanasInventoryPolicy(tx);
    if (!current?.enabled) throw new Error("Ananas knjiženje nije uključeno.");
    if (current.leaseUntil && new Date(current.leaseUntil).getTime() > Date.now()) throw new Error("Ananas istorija se već obrađuje. Sačekajte završetak.");
    await tx.adminSetting.update({ where: { key: ANANAS_INVENTORY_KEY }, data: { value: { ...current, leaseToken: token, leaseUntil: new Date(Date.now() + 360000).toISOString() } } });
    return current;
  });
  let imported = 0;
  try {
    const before = await postPendingAnanasInventory(40, actorId, started + 90000);
    const waiting = await db.ananasDocument.count({ where: { inventoryPostedAt: null, inventoryError: null, issuedAt: { gte: new Date("2025-05-31T22:00:00.000Z") } } });
    let through = policy.historyThrough;
    if (!waiting && new Date(through) < now) {
      const from = new Date(through), to = new Date(Math.min(now.getTime(), from.getTime() + 7 * 86400000));
      imported = (await syncAnanasDocuments(from, to, "INVENTORY_HISTORY")).count;
      through = to.toISOString();
    }
    const after = await postPendingAnanasInventory(40, actorId, started + 240000);
    await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('ananas-inventory-policy'))::text`;
      const current = await tx.adminSetting.findUniqueOrThrow({ where: { key: ANANAS_INVENTORY_KEY } });
      const value = current.value as Record<string, unknown>;
      if (value.leaseToken !== token) throw new Error("Ananas istorija je izgubila zaključavanje. Ponovite obradu.");
      await tx.adminSetting.update({ where: { key: ANANAS_INVENTORY_KEY }, data: { value: { ...value, historyThrough: through, leaseUntil: new Date(0).toISOString() } } });
    });
    const remaining = await db.ananasDocument.count({ where: { inventoryPostedAt: null, issuedAt: { gte: new Date("2025-05-31T22:00:00.000Z") } } });
    const errors = await db.ananasDocument.count({ where: { inventoryPostedAt: null, inventoryError: { not: null }, issuedAt: { gte: new Date("2025-05-31T22:00:00.000Z") } } });
    return { imported, posted: before.posted + after.posted, failed: before.failed + after.failed, through,
      complete: new Date(through) >= now && remaining === 0, needsReview: new Date(through) >= now && remaining > 0 && remaining === errors };
  } finally {
    await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('ananas-inventory-policy'))::text`;
      const setting = await tx.adminSetting.findUnique({ where: { key: ANANAS_INVENTORY_KEY } });
      const value = setting?.value as Record<string, unknown> | undefined;
      if (value?.leaseToken === token) await tx.adminSetting.update({ where: { key: ANANAS_INVENTORY_KEY }, data: { value: { ...value, leaseUntil: new Date(0).toISOString() } } });
    });
  }
}
