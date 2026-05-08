import "server-only";
import { headers } from "next/headers";
import { db } from "@/lib/db";

/**
 * Persist an admin action to the AuditLog. Best-effort — never throws so it
 * cannot block the actual mutation. Capture IP + UA from the request headers
 * (forwarded by middleware / proxies).
 */
export async function logAudit(args: {
  actorId?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  diff?: unknown;
}) {
  try {
    const h = await headers();
    const ip =
      h.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      h.get("x-real-ip") ??
      null;
    const userAgent = h.get("user-agent") ?? null;
    await db.auditLog.create({
      data: {
        actorId: args.actorId ?? null,
        action: args.action,
        entity: args.entity,
        entityId: args.entityId ?? null,
        diff: (args.diff ?? undefined) as never,
        ip,
        userAgent,
      },
    });
  } catch {
    // Audit must never break a write. Errors are intentionally swallowed.
  }
}
