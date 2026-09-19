import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/auth";
import type { AdminRoleName } from "@prisma/client";
import { db } from "@/lib/db";

/**
 * Thin wrappers around `auth()` for server components / route handlers.
 * Centralizes redirect targets so the auth UX stays consistent.
 */

export async function getSession() {
  return auth();
}

export const getCurrentUser = cache(async () => {
  const session = await auth();
  return session?.user && !session.user.invalidated ? session.user : null;
});

// React cache is scoped to one server render, never shared between requests.
// Layout and page guards share the read, but every new request rechecks access.
export const getCurrentAdmin = cache(async () => {
  const user = await getCurrentUser();
  if (!user || user.userType !== "admin") return null;
  const admin = await db.adminUser.findUnique({
    where: { id: user.id },
    select: { id: true, email: true, firstName: true, lastName: true, role: true, enabled: true },
  });
  if (!admin?.enabled) return null;
  return {
    ...user,
    id: admin.id,
    email: admin.email,
    name: [admin.firstName, admin.lastName].filter(Boolean).join(" ") || admin.email,
    role: admin.role,
  };
});

export async function requireUser(returnTo?: string) {
  const user = await getCurrentUser();
  if (!user || user.userType !== "customer") {
    const search = returnTo
      ? `?callbackUrl=${encodeURIComponent(returnTo)}`
      : "";
    redirect(`/nalog/prijava${search}`);
  }
  return user;
}

export async function requireAdmin(roles?: AdminRoleName[]) {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/prijava");
  if (roles && admin.role !== "SUPER" && !roles.includes(admin.role)) {
    redirect("/admin?forbidden=1");
  }
  return admin;
}
