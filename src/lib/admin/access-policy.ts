import type { AdminRoleName } from "@prisma/client";
import { adminNav } from "./nav-catalog";
import { erpPermissionCatalog } from "./erp-permission-catalog";
import { allowedRolesForErpModule } from "./erp-access";

export type AdminAccessPolicy = { version: 1; modules: string[] };
export type AdminAccessPrincipal = {
  role?: AdminRoleName | null;
  accessPolicy?: unknown;
};
type PermissionModule = { key: string; label: string };
const moduleAliases: Readonly<Record<string, string>> = {
  "/admin/erp/mobilni-tabovi": "/admin/tabovi",
  "/admin/erp/landing-sekcije": "/admin/erp/landing-strane",
  "/admin/erp/newsletter-kampanje": "/admin/newsletter",
  "/admin/erp/fiskalizacija": "/admin/fiskalizacija",
  "/admin/cenovnici": "/admin/erp/cenovnici",
  "/admin/erp/povrati": "/admin/erp/preuzimanja/povrati",
  "/admin/erp/reklamacije-izvestaji": "/admin/erp/reklamacije-dnevnik",
};
const canonicalModule = (key: string) => moduleAliases[key] ?? key;
const reserved = new Set([
  "/admin/erp/operativci", "/admin/erp/spcapp", "/admin/audit-log",
  "/admin/erp/integracije", "/admin/erp/admin-podesavanja",
]);
const legacyRoles = new Map<string, readonly AdminRoleName[]>();
export const permissionGroups: readonly {
  id: string; label: string; modules: readonly PermissionModule[];
}[] = (() => {
  const seen = new Set<string>();
  const groups = adminNav.map((group, index) => ({
    id: `group-${index}`, label: group.label,
    modules: group.items.flatMap((item) => {
      const key = canonicalModule(item.href);
      legacyRoles.set(key, item.allowed);
      if (reserved.has(key) || key === "/admin/erp" || seen.has(key)) return [];
      seen.add(key);
      return [{ key, label: item.label }];
    }),
  }));
  const erp = groups.find((group) => group.label === "ERP")!;
  groups.find((group) => group.label === "Sadržaj")!.modules.push({ key: "/admin/komentari", label: "Komentari kupaca" });
  legacyRoles.set("/admin/komentari", ["CONTENT"]);
  for (const [slug, label] of Object.entries(erpPermissionCatalog)) {
    const key = canonicalModule(`/admin/erp/${slug}`);
    if (!legacyRoles.has(key)) legacyRoles.set(key, allowedRolesForErpModule(slug));
    if (reserved.has(key) || seen.has(key)) continue;
    seen.add(key);
    erp.modules.push({ key, label });
  }
  return groups.filter((group) => group.modules.length > 0);
})();
const moduleKeys = new Set(permissionGroups.flatMap((group) => group.modules.map((module) => module.key)));

/** Missing and malformed policies never become a permissive policy. */
export function parseAccessPolicy(value: unknown): AdminAccessPolicy | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const policy = value as Record<string, unknown>;
  if (Object.keys(policy).some((key) => key !== "version" && key !== "modules") ||
      policy.version !== 1 || !Array.isArray(policy.modules) ||
      policy.modules.some((key) => typeof key !== "string" || !moduleKeys.has(key))) return null;
  return { version: 1, modules: [...new Set(policy.modules as string[])].sort() };
}

export function usesModuleAccess(principal: AdminAccessPrincipal) {
  return principal.role !== "SUPER" && (principal.role === "CUSTOM" || principal.accessPolicy != null);
}

export function effectiveAdminModules(principal: AdminAccessPrincipal): string[] {
  if (principal.role === "SUPER") return [...moduleKeys];
  if (usesModuleAccess(principal)) return parseAccessPolicy(principal.accessPolicy)?.modules ?? [];
  if (principal.role === "WAREHOUSE") return ["/admin/magacin"];
  return [...moduleKeys].filter((key) => !!principal.role && (legacyRoles.get(key) ?? []).includes(principal.role));
}

export function isWarehouseOnlyPolicy(policy: AdminAccessPolicy) {
  return policy.modules.length === 1 && policy.modules[0] === "/admin/magacin";
}

/** Exact module identity is required for custom accounts; role arrays only apply to legacy accounts. */
export function canAccessAdminModule(
  principal: AdminAccessPrincipal | null | undefined,
  module: string | readonly string[] | undefined,
  legacyAllowed?: readonly AdminRoleName[],
): boolean {
  if (!principal?.role) return false;
  if (principal.role === "SUPER") return true;
  if (legacyAllowed && (legacyAllowed.length === 0 || legacyAllowed.every((role) => role === "SUPER"))) return false;
  if (usesModuleAccess(principal)) {
    const policy = parseAccessPolicy(principal.accessPolicy);
    if (!policy?.modules.length || !module) return false;
    return (typeof module === "string" ? [module] : module).map(canonicalModule).some((key) =>
      key === "/admin/erp" || (moduleKeys.has(key) && policy.modules.includes(key)),
    );
  }
  if (principal.role === "WAREHOUSE" && !legacyAllowed?.includes("WAREHOUSE")) return false;
  if (legacyAllowed) return legacyAllowed.includes(principal.role);
  return true;
}

/** Only page navigation uses longest-prefix matching; action/API guards supply exact module keys. */
export function adminModuleForPage(pathname: string): string | null {
  const path = pathname.split(/[?#]/, 1)[0].replace(/\/$/, "") || "/";
  const candidates = [...moduleKeys, ...reserved, ...Object.keys(moduleAliases)].sort((a, b) => b.length - a.length);
  const matched = candidates.find((key) => path === key || (key !== "/admin" && path.startsWith(`${key}/`)));
  return matched ? canonicalModule(matched) : path === "/admin/erp" ? path : null;
}

export function adminAccessHome(principal: AdminAccessPrincipal) {
  const modules = effectiveAdminModules(principal);
  if (principal.role === "WAREHOUSE" && modules.includes("/admin/magacin")) return "/admin/magacin";
  return modules.length ? "/admin/erp" : "/admin/pristup-odbijen";
}
