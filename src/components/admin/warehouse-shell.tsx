"use client";

import Link from "next/link";
import { AdminRefreshButton } from "@/components/admin/refresh-button";
import { usePathname } from "next/navigation";
import { PackageCheck, Undo2, LogOut } from "lucide-react";
import { warehouseSignOut } from "@/app/admin/magacin/actions";

export function WarehouseShell({ name, children, adminHref }: { name: string; children: React.ReactNode; adminHref?: string }) {
  const pathname = usePathname();
  const returns = pathname.startsWith("/admin/magacin/povrat");
  return (
    <div data-warehouse-shell className="min-h-screen bg-canvas pb-[env(safe-area-inset-bottom)]">
      <header className="border-b border-border/60 bg-surface px-4 py-3">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
          <div className="min-w-0"><p className="text-lg font-semibold">Magacin</p><p className="truncate text-sm text-ink-500">{name}</p>{adminHref && <a href={adminHref} className="mt-1 inline-flex min-h-11 items-center text-sm font-medium underline underline-offset-4">← Admin panel</a>}</div>
          <div className="flex items-center gap-2 [&>button]:h-11 [&>button]:w-11"><AdminRefreshButton /><form action={warehouseSignOut}><button className="flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm"><LogOut size={16} />Odjavi se</button></form></div>
        </div>
      </header>
      <nav aria-label="Poslovi u magacinu" className="sticky top-0 z-30 border-b border-border/60 bg-surface p-3 print:hidden">
        <div className="mx-auto grid max-w-3xl grid-cols-2 gap-1 rounded-xl bg-muted p-1">
          {([
            { href: "/admin/magacin", label: "Picking", active: !returns, Icon: PackageCheck },
            { href: "/admin/magacin/povrat", label: "Povrat", active: returns, Icon: Undo2 },
          ]).map(({ href, label, active, Icon }) => <Link key={href} href={href} aria-current={active ? "page" : undefined} className={`flex min-h-12 items-center justify-center gap-2 rounded-lg text-base font-medium ${active ? "bg-foreground text-background shadow-sm" : "text-ink-500"}`}><Icon size={20} />{label}</Link>)}
        </div>
      </nav>
      <div className="mx-auto w-full max-w-3xl [&_button]:min-h-11 [&_input:not([type=hidden])]:min-h-11 [&_input]:text-base [&_select]:min-h-11 [&_select]:text-base [&_textarea]:text-base">{children}</div>
    </div>
  );
}
