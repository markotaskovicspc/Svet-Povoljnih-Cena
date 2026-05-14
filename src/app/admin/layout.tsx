import { redirect } from "next/navigation";
import Link from "next/link";
import { signOut } from "@/lib/auth/auth";
import { getCurrentUser } from "@/lib/auth/session";
import { headers } from "next/headers";
import { AdminSidebar } from "@/components/admin/sidebar";
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

  if (pathname === "/admin/erp" || pathname.startsWith("/admin/erp/")) {
    return (
      <div className="min-h-screen bg-canvas">
        <div className="mx-auto grid min-h-screen w-full max-w-[1600px] grid-cols-[260px_1fr]">
          <aside className="sticky top-0 h-screen overflow-y-auto border-r border-border/60 bg-surface p-5">
            <Link href="/admin/erp" className="font-display text-xl text-ink-900">
              Svet Akcija
            </Link>
            <p className="mt-1 text-xs uppercase tracking-[0.18em] text-ink-500">
              ERP demo
            </p>
            <nav className="mt-8 space-y-2 text-sm">
              <Link
                href="/admin/erp"
                className="block rounded-lg bg-muted-bg px-3 py-2 font-medium text-ink-900"
              >
                ERP sistem
              </Link>
              <Link
                href="/"
                target="_blank"
                className="block rounded-lg px-3 py-2 text-ink-500 hover:bg-muted-bg hover:text-ink-900"
              >
                Otvori prodavnicu →
              </Link>
            </nav>
          </aside>
          <div className="flex min-w-0 flex-col">
            <div className="border-b border-border/60 bg-surface/80 px-8 py-3 text-xs text-ink-500 backdrop-blur">
              Privremeni demo pristup za ERP pregled. Pravi admin login se uključuje kada povežemo bazu i env.
            </div>
            {children}
          </div>
        </div>
      </div>
    );
  }

  const user = await getCurrentUser();
  if (!user || user.userType !== "admin") {
    redirect(`/admin/prijava?callbackUrl=${encodeURIComponent(pathname)}`);
  }

  const nav = allowedNavFor(user.role);

  async function doSignOut() {
    "use server";
    await signOut({ redirectTo: "/admin/prijava" });
  }

  return (
    <div className="min-h-screen bg-canvas">
      <div className="mx-auto grid min-h-screen w-full max-w-[1600px] grid-cols-[260px_1fr]">
        <aside className="sticky top-0 h-screen overflow-y-auto border-r border-border/60 bg-surface">
          <AdminSidebar nav={nav} />
        </aside>
        <div className="flex min-w-0 flex-col">
          <div className="flex items-center justify-between border-b border-border/60 bg-surface/80 px-8 py-3 backdrop-blur">
            <p className="text-xs text-ink-500">
              Prijavljen kao{" "}
              <span className="font-medium text-ink-900">{user.name}</span>{" "}
              <span className="text-ink-500">
                · {user.role ? ADMIN_ROLE_LABEL[user.role] : ""}
              </span>
            </p>
            <div className="flex items-center gap-2">
              <Link
                href="/"
                className="text-xs text-ink-500 hover:text-walnut"
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
