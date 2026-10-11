import { redirect } from "next/navigation";
import Link from "next/link";
import { signOut } from "@/lib/auth/auth";
import { getCurrentAdmin } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { cookies, headers } from "next/headers";
import { AdminThemeProvider, AdminThemeToggle } from "@/components/admin/theme";
import { AdminSidebar, AdminMobileNav } from "@/components/admin/sidebar";
import {
  ADMIN_ROLE_LABEL,
  adminNavPreferencesFromColumns,
  allowedNavFor,
  applyAdminNavPreferences,
  isAuthorized,
} from "@/lib/admin";
import { withSavedViewLinks } from "@/lib/admin/nav";
import { allowedRolesForErpModule } from "@/lib/admin/erp-access";
import { getErpModuleDefinition } from "@/lib/admin/erp";
import { Button } from "@/components/ui/button";
import { OrderNotifications } from "@/components/admin/order-notifications";
import { canReceiveOrderPush } from "@/lib/admin/push-policy";
import "./theme.css";

export const dynamic = "force-dynamic";
export const metadata = {
  manifest: "/admin-manifest.webmanifest",
  appleWebApp: { capable: true, title: "SPC Admin", statusBarStyle: "default" as const },
};

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = (await headers()).get("x-pathname") ?? "/admin";
  const initialTheme = (await cookies()).get("spc-admin-theme")?.value === "dark"
    ? "dark"
    : "light";

  // Login page renders without the shell.
  if (pathname === "/admin/prijava") {
    return (
      <AdminThemeProvider initialTheme={initialTheme}>
        <div className="absolute right-4 top-4 print:hidden">
          <AdminThemeToggle />
        </div>
        <div className="min-h-screen bg-canvas">{children}</div>
      </AdminThemeProvider>
    );
  }

  const user = await getCurrentAdmin();
  if (!user) {
    redirect(`/admin/prijava?callbackUrl=${encodeURIComponent(pathname)}`);
  }

  const availableNav = allowedNavFor(user.role);
  const savedNavigation = await db.adminSavedView.findMany({
    where: {
      adminUserId: user.id,
      OR: [
        { module: "admin-navigation", isDefault: true },
        { module: { notIn: ["admin-navigation", "dashboard"] } },
      ],
    },
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      module: true,
      columns: true,
      updatedAt: true,
    },
  });
  const navigationView = savedNavigation
    .filter((view) => view.module === "admin-navigation")
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0];
  const gridViews = savedNavigation.flatMap((view) => {
    const definition = getErpModuleDefinition(view.module);
    const allowed = allowedRolesForErpModule(view.module);
    return definition &&
      !definition.redirectHref &&
      isAuthorized(user.role, allowed)
      ? [{ ...view, title: definition.title, allowed }]
      : [];
  });
  const availableNavWithViews = withSavedViewLinks(availableNav, gridViews);
  const nav = applyAdminNavPreferences(
    availableNavWithViews,
    adminNavPreferencesFromColumns(navigationView?.columns),
  );

  async function doSignOut() {
    "use server";
    await signOut({ redirectTo: "/admin/prijava" });
  }

  return (
    <AdminThemeProvider initialTheme={initialTheme}>
      <div className="min-h-screen bg-canvas print:min-h-0 print:bg-white">
        <div
          data-admin-shell
          className="grid min-h-screen w-full md:grid-cols-[260px_1fr] print:block print:min-h-0"
        >
          <aside className="sticky top-0 hidden h-screen overflow-y-auto border-r border-border/60 bg-surface md:block print:hidden">
            <AdminSidebar nav={nav} availableNav={availableNavWithViews} />
          </aside>
          <div className="flex min-w-0 flex-col print:block">
            <div className="flex items-center justify-between gap-2 border-b border-border/60 bg-surface/80 px-4 py-3 backdrop-blur md:px-8 print:hidden">
              <div className="flex min-w-0 items-center gap-2">
                <div className="md:hidden">
                  <AdminMobileNav
                    nav={nav}
                    availableNav={availableNavWithViews}
                  />
                </div>
                <p className="min-w-0 truncate text-xs text-ink-500">
                  Prijavljen kao{" "}
                  <span className="font-medium text-ink-900">{user.name}</span>{" "}
                  <span className="text-ink-500">
                    · {user.role ? ADMIN_ROLE_LABEL[user.role] : ""}
                  </span>
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <AdminThemeToggle />
                <Link
                  href="/"
                  className="hidden text-xs text-ink-500 hover:text-walnut sm:inline"
                  target="_blank"
                >
                  Otvori prodavnicu →
                </Link>
                <form action={doSignOut}>
                  <Button type="submit" variant="outline" size="sm">
                    Odjava
                  </Button>
                </form>
              </div>
            </div>
            {canReceiveOrderPush(user.role) && <OrderNotifications adminId={user.id} />}
            {children}
          </div>
        </div>
      </div>
    </AdminThemeProvider>
  );
}
