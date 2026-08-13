import "server-only";
import { headers } from "next/headers";
import { db } from "@/lib/db";

/** Persist an admin action. Callers decide whether a missing audit blocks work. */
export async function logAudit(args: {
  actorId?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  diff?: unknown;
}) {
  const h = await headers();
  const ip =
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    h.get("x-real-ip") ??
    null;
  const userAgent = h.get("user-agent") ?? null;
  return db.auditLog.create({
    data: {
      actorId: args.actorId ?? null,
      action: args.action,
      entity: args.entity,
      entityId: args.entityId ?? null,
      diff: (args.diff ?? undefined) as never,
      ip,
      userAgent,
    },
    select: { id: true },
  });
}

/** Finalize the durable attempt marker instead of relying on a second insert. */
export async function finalizeAudit(args: {
  id: string;
  action: string;
  entity: string;
  entityId?: string | null;
  diff?: unknown;
}) {
  await db.auditLog.update({
    where: { id: args.id },
    data: {
      action: args.action,
      entity: args.entity,
      entityId: args.entityId ?? null,
      diff: (args.diff ?? undefined) as never,
    },
  });
}
