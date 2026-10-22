import "server-only";
import { createDatabasePool } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import type { Pool } from "pg";

let lockPool: Pool | undefined;

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
  // The ordinary Vercel Prisma pool has max=1. Holding its only connection
  // here while work() queries db would deadlock before reaching the provider.
  // A separate, bounded pool owns only the advisory-lock transaction.
  lockPool ??= createDatabasePool(1);
  const client = await lockPool.connect();
  let destroy = false;
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL idle_in_transaction_session_timeout = '120s'");
    const result = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_xact_lock(hashtext($1)) AS locked", [`order-return:${orderId}`],
    );
    if (!result.rows[0]?.locked) throw new Error("Povrat ove porudžbine se već obrađuje. Sačekajte završetak obrade i osvežite pregled.");
    const value = await work();
    await client.query("COMMIT");
    return value;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { destroy = true; }
    throw error;
  } finally {
    client.release(destroy);
  }
}
