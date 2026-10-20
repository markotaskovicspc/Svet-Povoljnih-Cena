"use client";
import { useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { refreshAdminData } from "@/app/admin/refresh-action";
import { toast } from "sonner";

export function AdminRefreshButton({ label = "Osveži podatke" }: { label?: string }) {
  const pathname = usePathname(), router = useRouter();
  const [pending, start] = useTransition();
  return <button type="button" aria-label={label} title={label} disabled={pending}
    className="inline-flex h-8 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-background hover:bg-muted disabled:opacity-50"
    onClick={() => start(async () => {
      try { await refreshAdminData(pathname); router.refresh(); }
      catch { toast.error("Osvežavanje nije uspelo. Pokušajte ponovo."); }
    })}><RefreshCw className={"size-4 " + (pending ? "animate-spin" : "")} aria-hidden /></button>;
}
