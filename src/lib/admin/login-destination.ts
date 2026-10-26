import type { AdminRoleName } from "@prisma/client";

import { adminAccessHome, adminModuleForPage, canAccessAdminModule, usesModuleAccess, type AdminAccessPrincipal } from "./access-policy";

const ADMIN_HOME = "/admin/erp";
/** A login entry point must not keep a different account in the warehouse shell. */
export function adminLoginDestination(role: AdminRoleName | null | undefined, callback: string, accessPolicy?: unknown) {
  const principal: AdminAccessPrincipal = { role, accessPolicy };
  let destination = ADMIN_HOME;
  try {
    const url = new URL(callback, "https://admin.invalid");
    if (url.origin === "https://admin.invalid" && (url.pathname === "/admin" || url.pathname.startsWith("/admin/")) &&
      !url.pathname.startsWith("/admin/prijava") && !url.pathname.startsWith("/admin/magacin/prijava")) {
      destination = `${url.pathname}${url.search}${url.hash}`;
    }
  } catch { /* Keep the safe local default. */ }
  const pathname = new URL(destination, "https://admin.invalid").pathname;
  const warehouse = pathname === "/admin/magacin" || pathname.startsWith("/admin/magacin/");
  if (usesModuleAccess(principal)) {
    const accessModule = adminModuleForPage(pathname);
    return accessModule && canAccessAdminModule(principal, accessModule) ? destination : adminAccessHome(principal);
  }
  if (role === "WAREHOUSE") return warehouse ? destination : "/admin/magacin";
  if (warehouse && (pathname === "/admin/magacin" || (role !== "SUPER" && role !== "OPS"))) return ADMIN_HOME;
  return destination;
}
