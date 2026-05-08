"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import type { AdminNavGroup } from "@/lib/admin/nav";

export function AdminSidebar({ nav }: { nav: AdminNavGroup[] }) {
  const pathname = usePathname() ?? "/admin";
  return (
    <nav className="flex flex-col gap-6 px-4 py-6 text-sm">
      <Link
        href="/admin"
        className="font-display text-lg tracking-tight text-ink-900 hover:text-walnut"
      >
        SPC <span className="text-ink-500">admin</span>
      </Link>
      {nav.map((group) => (
        <div key={group.label} className="flex flex-col gap-1">
          <p className="px-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-300">
            {group.label}
          </p>
          {group.items.map((item) => {
            const active =
              item.href === "/admin"
                ? pathname === "/admin"
                : pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "rounded-lg px-2 py-1.5 transition-colors",
                  active
                    ? "bg-walnut/10 text-walnut"
                    : "text-ink-700 hover:bg-muted-bg hover:text-ink-900",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
