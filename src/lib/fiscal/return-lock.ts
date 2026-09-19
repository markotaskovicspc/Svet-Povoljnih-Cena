import "server-only";
import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";

export async function lockOrderReturn(tx: Prisma.TransactionClient, orderId: string) {
  const rows = await tx.$queryRaw<Array<{ locked: boolean }>>`SELECT pg_try_advisory_xact_lock(hashtext(${`order-return:${orderId}`})) AS "locked"`;
  // Never fill the connection pool with transactions waiting on a fiscal call
  // which itself needs a free connection to persist its response.
  if (!rows[0]?.locked) throw new Error("Povrat ove porudžbine se već obrađuje. Sačekajte završetak obrade i osvežite pregled.");
}

// Keep the advisory lock on a dedicated transaction while the fiscal request
// and its short, durable posting transactions use their own connections.
// No external request is rolled back or blindly resent after an uncertain reply.
export async function withOrderReturnLock<T>(orderId: string, work: () => Promise<T>): Promise<T> {
  return db.$transaction(async tx => {
    await lockOrderReturn(tx, orderId);
    return work();
  }, { maxWait: 10_000, timeout: 120_000 });
}
