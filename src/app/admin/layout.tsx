import { redirect } from "next/navigation";
import Link from "next/link";
import { signOut } from "@/lib/auth/auth";
import { getCurrentUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { headers } from "next/headers";
import { AdminSidebar, AdminMobileNav } from "@/components/admin/sidebar";
import { allowedNavFor, ADMIN_ROLE_LABEL } from "@/lib/admin";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = (await headers()).get("x-pathname") ?? "/admin";

  // Login page renders without the shell.
  if (pathname === "/admin/prijava") {
    return <div className="min-h-screen bg-canvas">{children}</div>;
  }

  const sessionUser = await getCurrentUser();
  if (!sessionUser || sessionUser.userType !== "admin") {
    redirect(`/admin/prijava?callbackUrl=${encodeURIComponent(pathname)}`);
  }

  // JWT sessions can outlive an admin account being disabled, deleted, or
  // assigned a different role. Revalidate the authoritative record for every
  // admin route so pages without their own action guard cannot use stale access.
  const admin = await db.adminUser.findUnique({
    where: { id: sessionUser.id },
    select: {
      email: true,
      firstName: true,
      lastName: true,
      role: true,
      enabled: true,
    },
  });
  if (!admin?.enabled) {
    redirect(`/admin/prijava?callbackUrl=${encodeURIComponent(pathname)}`);
  }

  const user = {
    ...sessionUser,
    email: admin.email,
    name:
      [admin.firstName, admin.lastName].filter(Boolean).join(" ") ||
      admin.email,
    role: admin.role,
  };

  const nav = allowedNavFor(user.role);

  async function doSignOut() {
    "use server";
    await signOut({ redirectTo: "/admin/prijava" });
  }

  return (
    <div className="min-h-screen bg-canvas">
      <div className="mx-auto grid min-h-screen w-full max-w-[1600px] md:grid-cols-[260px_1fr]">
        <aside className="sticky top-0 hidden h-screen overflow-y-auto border-r border-border/60 bg-surface md:block">
          <AdminSidebar nav={nav} />
        </aside>
        <div className="flex min-w-0 flex-col">
          <div className="flex items-center justify-between gap-2 border-b border-border/60 bg-surface/80 px-4 py-3 backdrop-blur md:px-8">
            <div className="flex min-w-0 items-center gap-2">
              <div className="md:hidden">
                <AdminMobileNav nav={nav} />
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
          {children}
        </div>
      </div>
    </div>
  );
}
