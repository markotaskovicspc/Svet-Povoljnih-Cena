"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import type { AdminNavGroup } from "@/lib/admin/nav";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { MenuIcon } from "lucide-react";
import { useState } from "react";
import { activeAdminNavHref } from "@/lib/admin/nav";

function AdminNavContent({
  nav,
  pathname,
  onNavigate,
}: {
  nav: AdminNavGroup[];
  pathname: string;
  onNavigate?: () => void;
}) {
  const activeHref = activeAdminNavHref(nav, pathname);

  return (
    <nav className="flex flex-col gap-6 px-4 py-6 text-sm">
      <Link
        href="/admin"
        prefetch={false}
        onClick={onNavigate}
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
            const active = item.href === activeHref;
            return (
              <Link
                key={item.href}
                href={item.href}
                prefetch={false}
                onClick={onNavigate}
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

export function AdminSidebar({ nav }: { nav: AdminNavGroup[] }) {
  const pathname = usePathname() ?? "/admin";
  return <AdminNavContent nav={nav} pathname={pathname} />;
}

export function AdminMobileNav({ nav }: { nav: AdminNavGroup[] }) {
  const pathname = usePathname() ?? "/admin";
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button variant="outline" size="icon" aria-label="Otvori meni" />
        }
      >
        <MenuIcon />
      </SheetTrigger>
      <SheetContent
        side="left"
        className="flex h-[100dvh] w-4/5 max-w-xs flex-col overflow-hidden p-0"
      >
        <SheetTitle className="sr-only">Admin navigacija</SheetTitle>
        <div
          data-testid="admin-mobile-nav-scroll"
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[max(env(safe-area-inset-bottom),0.75rem)]"
        >
          <AdminNavContent
            nav={nav}
            pathname={pathname}
            onNavigate={() => setOpen(false)}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
