import "server-only";
import { redirect } from "next/navigation";
import { AdminRoleName } from "@prisma/client";
import { getCurrentUser } from "@/lib/auth/session";

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
export function isAuthorized(
  role: AdminRoleName | null | undefined,
  allowed: readonly AdminRoleName[],
) {
  if (!role) return false;
  if (role === "SUPER") return true;
  return allowed.includes(role);
}

/**
 * Server-component / route-handler guard. Returns the admin session or
 * redirects. Never returns null on success.
 */
export async function requireAdminAction(allowed?: readonly AdminRoleName[]) {
  const user = await getCurrentUser();
  if (!user || user.userType !== "admin") {
    redirect("/admin/prijava");
  }
  if (allowed && !isAuthorized(user.role, allowed)) {
    redirect("/admin?forbidden=1");
  }
  return user as typeof user & { role: AdminRoleName };
}

/**
 * Wrap a Server Action so it (a) requires an admin session with the given
 * role, (b) executes the inner function, (c) audits success / failure. The
 * inner function returns a generic shape that callers can spread into UI.
 */
export function withAdmin<TArgs extends unknown[], TOut>(
  meta: { allowed?: readonly AdminRoleName[]; action: string; entity: string },
  fn: (
    actorId: string,
    ...args: TArgs
  ) => Promise<{ ok: true; entityId?: string | null; diff?: unknown; result?: TOut } | { ok: false; error: string }>,
): (...args: TArgs) => Promise<void> {
  return async (...args: TArgs) => {
    const admin = await requireAdminAction(meta.allowed);
    const { logAudit } = await import("./audit");
    try {
      const out = await fn(admin.id, ...args);
      if (out.ok) {
        await logAudit({
          actorId: admin.id,
          action: meta.action,
          entity: meta.entity,
          entityId: out.entityId ?? null,
          diff: out.diff,
        });
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Nepoznata greška.";
      await logAudit({
        actorId: admin.id,
        action: `${meta.action}.error`,
        entity: meta.entity,
        diff: { error: message },
      });
    }
  };
}
