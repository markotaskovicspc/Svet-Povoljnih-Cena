"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import type { AdminNavGroup } from "@/lib/admin/nav";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ArrowDown, ArrowUp, MenuIcon, Settings2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { activeAdminNavHref } from "@/lib/admin/nav";

function AdminNavContent({
  nav,
  pathname,
  search,
  onNavigate,
  customizer,
}: {
  nav: AdminNavGroup[];
  pathname: string;
  search?: string;
  onNavigate?: () => void;
  customizer?: ReactNode;
}) {
  const activeHref = activeAdminNavHref(nav, pathname, search);

  return (
    <nav className="flex flex-col gap-6 px-4 py-6 text-sm">
      <div className="flex items-center justify-between gap-2">
        <Link
          href="/admin"
          prefetch={false}
          onClick={onNavigate}
          className="font-display text-lg tracking-tight text-ink-900 hover:text-walnut"
        >
          SPC <span className="text-ink-500">admin</span>
        </Link>
        {customizer}
      </div>
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
                aria-current={active ? "page" : undefined}
                className={cn(
                  "rounded-lg px-2 py-1.5 transition-colors",
                  item.nested && "ml-3 border-l border-border/70 pl-3 text-xs",
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

function AdminNavCustomizer({
  nav,
  availableNav,
}: {
  nav: AdminNavGroup[];
  availableNav: AdminNavGroup[];
}) {
  const router = useRouter();
  const availableItems = availableNav.flatMap((group) =>
    group.items.map((item) => ({ ...item, group: group.label })),
  );
  const visibleHrefs = nav.flatMap((group) => group.items.map((item) => item.href));
  const initialOrder = Array.from(
    new Set([
      ...visibleHrefs,
      ...availableItems.map((item) => item.href),
    ]),
  );
  const [open, setOpen] = useState(false);
  const [order, setOrder] = useState(initialOrder);
  const [visible, setVisible] = useState(() => new Set(visibleHrefs));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const byHref = new Map(availableItems.map((item) => [item.href, item]));

  const move = (href: string, direction: -1 | 1) => {
    setOrder((current) => {
      const index = current.indexOf(href);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  };

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/saved-views", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          module: "admin-navigation",
          name: "Levi meni",
          query: "",
          filters: [],
          sorting: [],
          visibleColumns: order.filter((href) => visible.has(href)),
          columnOrder: order,
          columnWidths: {},
          context: {},
          isDefault: true,
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      if (!response.ok) {
        throw new Error(payload?.error ?? "Meni nije sačuvan.");
      }
      setMessage({ ok: true, text: "Lični meni je sačuvan." });
      setOpen(false);
      router.refresh();
    } catch (error) {
      setMessage({
        ok: false,
        text: error instanceof Error ? error.message : "Meni nije sačuvan.",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Prilagodi levi meni"
        onClick={() => {
          setMessage(null);
          setOpen(true);
        }}
      >
        <Settings2 className="size-4" aria-hidden />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Prilagodi levi meni</DialogTitle>
            <DialogDescription>
              Izaberite i poređajte prečice. Ovlašćenja se ovim ne menjaju.
            </DialogDescription>
          </DialogHeader>
          {message ? (
            <p
              role={message.ok ? "status" : "alert"}
              className={cn(
                "rounded-lg border px-3 py-2 text-sm",
                message.ok
                  ? "border-success/25 bg-success/10 text-success"
                  : "border-danger/25 bg-danger/10 text-danger",
              )}
            >
              {message.text}
            </p>
          ) : null}
          <div className="max-h-[55dvh] space-y-2 overflow-y-auto pr-1">
            {order.flatMap((href, index) => {
              const item = byHref.get(href);
              if (!item) return [];
              const dashboard = href === "/admin";
              return [
                <div
                  key={href}
                  className="flex items-center gap-2 rounded-lg border border-border/60 px-3 py-2"
                >
                  <input
                    type="checkbox"
                    checked={dashboard || visible.has(href)}
                    disabled={dashboard}
                    aria-label={`Prikaži ${item.label}`}
                    onChange={(event) => {
                      setVisible((current) => {
                        const next = new Set(current);
                        if (event.target.checked) next.add(href);
                        else next.delete(href);
                        next.add("/admin");
                        return next;
                      });
                    }}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-ink-900">{item.label}</p>
                    <p className="text-xs text-ink-500">{item.group}</p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled={dashboard || index === 0}
                    aria-label={`Pomeri ${item.label} gore`}
                    onClick={() => move(href, -1)}
                  >
                    <ArrowUp className="size-4" aria-hidden />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled={dashboard || index === order.length - 1}
                    aria-label={`Pomeri ${item.label} dole`}
                    onClick={() => move(href, 1)}
                  >
                    <ArrowDown className="size-4" aria-hidden />
                  </Button>
                </div>,
              ];
            })}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Otkaži
            </Button>
            <Button type="button" disabled={saving} onClick={save}>
              {saving ? "Čuvanje…" : "Sačuvaj meni"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function AdminSidebar({
  nav,
  availableNav,
}: {
  nav: AdminNavGroup[];
  availableNav: AdminNavGroup[];
}) {
  const pathname = usePathname() ?? "/admin";
  const search = useSearchParams().toString();
  return (
    <AdminNavContent
      nav={nav}
      pathname={pathname}
      search={search}
      customizer={<AdminNavCustomizer nav={nav} availableNav={availableNav} />}
    />
  );
}

export function AdminMobileNav({
  nav,
  availableNav,
}: {
  nav: AdminNavGroup[];
  availableNav: AdminNavGroup[];
}) {
  const pathname = usePathname() ?? "/admin";
  const search = useSearchParams().toString();
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
            search={search}
            onNavigate={() => setOpen(false)}
            customizer={
              <AdminNavCustomizer nav={nav} availableNav={availableNav} />
            }
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
