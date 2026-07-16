import type { AdminRoleName } from "@prisma/client";

export function isAuthorized(
  role: AdminRoleName | null | undefined,
  allowed: readonly AdminRoleName[],
) {
  if (!role) return false;
  if (role === "SUPER") return true;
  return allowed.includes(role);
}
