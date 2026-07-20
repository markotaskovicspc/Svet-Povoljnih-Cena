import "server-only";
import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { AdminRoleName } from "@prisma/client";
import { getCurrentUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { logOperationalError } from "@/lib/monitoring";
import {
  adminActionError,
  adminActionSuccess,
  type AdminActionFieldErrors,
  type AdminActionState,
} from "./action-state";
import { isAuthorized } from "./authorization";

export { isAuthorized } from "./authorization";

export const ADMIN_ROLE_LABEL: Record<AdminRoleName, string> = {
  SUPER: "Super admin",
  CONTENT: "Sadržaj",
  OPS: "Operativa",
  ADS: "Marketing",
};

/**
 * SUPER may do everything. Otherwise the role must be in the explicit
 * allow-list. Pure function so it can be reused on the client (nav filtering)
 * via a server-resolved session payload.
 */
/**
 * Server-component / route-handler guard. Returns the admin session or
 * redirects. Never returns null on success.
 */
export async function requireAdminAction(allowed?: readonly AdminRoleName[]) {
  const user = await getCurrentUser();
  if (!user || user.userType !== "admin") {
    redirect("/admin/prijava");
  }
  const admin = await db.adminUser.findUnique({
    where: { id: user.id },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      role: true,
      enabled: true,
    },
  });
  if (!admin?.enabled) {
    redirect("/admin/prijava");
  }
  if (allowed && !isAuthorized(admin.role, allowed)) {
    redirect("/admin?forbidden=1");
  }
  return {
    ...user,
    id: admin.id,
    email: admin.email,
    name:
      [admin.firstName, admin.lastName].filter(Boolean).join(" ") ||
      admin.email,
    role: admin.role,
  } as typeof user & { role: AdminRoleName };
}

type AdminActionMeta = {
  allowed?: readonly AdminRoleName[];
  action: string;
  entity: string;
};

type AdminActionHandler<TArgs extends unknown[], TOut> = (
  actorId: string,
  ...args: TArgs
) => Promise<
  | {
      ok: true;
      entityId?: string | null;
      diff?: unknown;
      message?: string;
      result?: TOut;
    }
  | {
      ok: false;
      error?: string;
      message?: string;
      fieldErrors?: AdminActionFieldErrors;
    }
>;

export function withAdminState<TArgs extends unknown[], TOut>(
  meta: AdminActionMeta,
  fn: AdminActionHandler<TArgs, TOut>,
): (...args: TArgs) => Promise<AdminActionState<TOut>> {
  return async (...args: TArgs) => {
    const admin = await requireAdminAction(meta.allowed);
    const { logAudit } = await import("./audit");
    const requestId = randomUUID();
    try {
      await logAudit({
        actorId: admin.id,
        action: `${meta.action}.attempt`,
        entity: meta.entity,
        diff: { requestId },
      });
    } catch (error) {
      logOperationalError("admin.audit.attempt_failed", error, {
        action: meta.action,
        actorId: admin.id,
        requestId,
      });
      return adminActionError<TOut>(
        `Akcija nije izvršena jer audit zapis nije sačuvan. Referenca: ${requestId}`,
      );
    }
    try {
      const out = await fn(admin.id, ...args);
      if (out.ok) {
        try {
          await logAudit({
            actorId: admin.id,
            action: meta.action,
            entity: meta.entity,
            entityId: out.entityId ?? null,
            diff: auditDiff(requestId, out.diff),
          });
        } catch (error) {
          logOperationalError("admin.audit.success_failed", error, {
            action: meta.action,
            actorId: admin.id,
            requestId,
          });
          return adminActionError<TOut>(
            `Akcija je izvršena, ali završni audit zapis nije potvrđen. Ne ponavljajte akciju pre provere. Referenca: ${requestId}`,
          );
        }
        return adminActionSuccess<TOut>(out.message, out.result);
      }
      const message = out.message ?? out.error ?? "Neispravan unos.";
      await recordFailureAudit(logAudit, {
        actorId: admin.id,
        action: meta.action,
        entity: meta.entity,
        requestId,
        error: message,
      });
      return adminActionError<TOut>(message, out.fieldErrors);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Nepoznata greška.";
      await recordFailureAudit(logAudit, {
        actorId: admin.id,
        action: meta.action,
        entity: meta.entity,
        requestId,
        error: message,
      });
      return adminActionError<TOut>(message);
    }
  };
}

function auditDiff(requestId: string, diff: unknown) {
  if (diff && typeof diff === "object" && !Array.isArray(diff)) {
    return { ...(diff as Record<string, unknown>), requestId };
  }
  return { requestId, result: diff ?? null };
}

async function recordFailureAudit(
  logAudit: (args: {
    actorId?: string | null;
    action: string;
    entity: string;
    entityId?: string | null;
    diff?: unknown;
  }) => Promise<void>,
  args: {
    actorId: string;
    action: string;
    entity: string;
    requestId: string;
    error: string;
  },
) {
  try {
    await logAudit({
      actorId: args.actorId,
      action: `${args.action}.error`,
      entity: args.entity,
      diff: { requestId: args.requestId, error: args.error },
    });
  } catch (error) {
    logOperationalError("admin.audit.error_failed", error, {
      action: args.action,
      actorId: args.actorId,
      requestId: args.requestId,
    });
  }
}

/**
 * Wrap a Server Action so it (a) requires an admin session with the given
 * role, (b) executes the inner function, (c) audits success / failure.
 * Use `withAdminState` for forms that render `useActionState` feedback.
 */
export function withAdmin<TArgs extends unknown[], TOut>(
  meta: AdminActionMeta,
  fn: AdminActionHandler<TArgs, TOut>,
): (...args: TArgs) => Promise<void> {
  const action = withAdminState(meta, fn);
  return async (...args: TArgs) => {
    await action(...args);
  };
}
