import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";

/**
 * Server cart sync (Phase 3C — item 2).
 *
 * Logged-in users keep a server-side mirror of the Zustand cart so it survives
 * device changes. The client merges localStorage cart with the server snapshot
 * on login (server lines win on SKU collision) — that merge logic lives in the
 * client `useCart` rehydration step.
 */

export const cartLineSchema = z.object({
  sku: z.string().min(1).max(64),
  name: z.string().min(1).max(255),
  slug: z.string().min(1).max(255),
  qty: z.int().min(0).max(99),
  unitPriceFull: z.number().nonnegative(),
  unitPriceSale: z.number().nonnegative(),
  unitPriceLoyalty: z.number().nonnegative().optional(),
  loyaltyDiscountPct: z.number().min(0).max(100).optional(),
  thumbnailUrl: z.string().max(2048).optional(),
  variant: z.string().max(120).optional(),
  familyCode: z.string().max(64).optional(),
  withAssembly: z.boolean().optional(),
  assemblyPrice: z.number().nonnegative().optional(),
});

export const cartPayloadSchema = z.object({
  lines: z.array(cartLineSchema).max(100),
});

export type ServerCartLine = z.infer<typeof cartLineSchema>;

export function normalizeServerCartLines(
  lines: ServerCartLine[],
): ServerCartLine[] {
  const bySku = new Map<string, ServerCartLine>();

  for (const line of lines) {
    if (line.qty <= 0) continue;
    const existing = bySku.get(line.sku);
    bySku.set(
      line.sku,
      existing
        ? { ...line, qty: Math.min(99, existing.qty + line.qty) }
        : { ...line, qty: Math.min(99, line.qty) },
    );
  }

  return Array.from(bySku.values());
}

export function mergeServerCartLines(
  currentLines: ServerCartLine[],
  incomingLines: ServerCartLine[],
): ServerCartLine[] {
  const current = normalizeServerCartLines(currentLines);
  const incoming = normalizeServerCartLines(incomingLines);
  const incomingSkus = new Set(incoming.map((line) => line.sku));
  return normalizeServerCartLines([
    ...current.filter((line) => !incomingSkus.has(line.sku)),
    ...incoming,
  ]);
}

export async function getServerCart(userId: string): Promise<ServerCartLine[]> {
  const row = await db.cart.findUnique({ where: { userId } });
  if (!row) return [];
  const parsed = z.array(cartLineSchema).safeParse(row.lines);
  return parsed.success ? normalizeServerCartLines(parsed.data) : [];
}

export async function saveServerCart(
  userId: string,
  lines: ServerCartLine[],
): Promise<void> {
  // Drop empty / zero-qty lines defensively.
  const clean = normalizeServerCartLines(lines);
  await db.cart.upsert({
    where: { userId },
    create: { userId, lines: clean },
    update: { lines: clean },
  });
}

export async function mergeServerCart(
  userId: string,
  lines: ServerCartLine[],
): Promise<void> {
  await db.$transaction(async (tx) => {
    // Login sync can arrive concurrently from several browser tabs. Serialize
    // promotion writes per customer so an older tab can only add to, never
    // replace, the newest guest snapshot.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('spc-cart'), hashtext(${userId}))::text AS "lock"`;
    const row = await tx.cart.findUnique({ where: { userId } });
    const parsed = z.array(cartLineSchema).safeParse(row?.lines);
    const current = parsed.success ? parsed.data : [];
    const merged = mergeServerCartLines(current, lines);
    await tx.cart.upsert({
      where: { userId },
      create: { userId, lines: merged },
      update: { lines: merged },
    });
  });
}

export async function clearServerCart(userId: string): Promise<void> {
  await db.cart.deleteMany({ where: { userId } });
}
