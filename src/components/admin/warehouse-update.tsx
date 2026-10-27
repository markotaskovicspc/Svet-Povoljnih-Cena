"use client";

import { useEffect, useState } from "react";
import { watchWarehouseRelease } from "@/lib/admin/warehouse-release-watch";

export function WarehouseUpdate({ release }: { release: string }) {
  const [pending, setPending] = useState(false);
  useEffect(() => {
    const watcher = watchWarehouseRelease({
      release,
      readRelease: async () => {
        const response = await fetch("/api/admin/warehouse-version", { cache: "no-store", signal: AbortSignal.timeout(5_000) });
        if (!response.ok || response.redirected || !response.headers.get("content-type")?.includes("application/json")) return null;
        const data = await response.json();
        return typeof data.release === "string" ? data.release : null;
      },
      canReload: () => document.visibilityState === "visible" && (window.location.pathname === "/admin/magacin" || document.querySelector('[data-warehouse-update-safe="true"]') !== null),
      reload: () => window.location.reload(),
      onPending: () => setPending(true),
    });
    const check = () => { void watcher.check(); };
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => { watcher.stop(); window.removeEventListener("focus", check); document.removeEventListener("visibilitychange", check); };
  }, [release]);
  return pending ? <div role="status" className="mx-auto max-w-3xl border-2 border-amber-500 bg-amber-50 p-4 text-lg font-semibold text-amber-950 print:hidden">Nova verzija je spremna. Završite trenutni unos — ekran će se sam ažurirati čim unos bude sačuvan.</div> : null;
}
