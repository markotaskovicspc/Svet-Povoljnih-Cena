"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function NewsletterStatsRefresh({ observedAt, protectEditor = false }: { observedAt: string; protectEditor?: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!protectEditor) return;
    const editor = document.getElementById("newsletter-campaign-editor");
    const changed = () => setDirty(true);
    const clicked = (event: Event) => {
      if ((event.target as Element).closest('button[type="button"]')) changed();
    };
    editor?.addEventListener("input", changed);
    editor?.addEventListener("change", changed);
    editor?.addEventListener("drop", changed);
    editor?.addEventListener("click", clicked);
    return () => {
      editor?.removeEventListener("input", changed);
      editor?.removeEventListener("change", changed);
      editor?.removeEventListener("drop", changed);
      editor?.removeEventListener("click", clicked);
    };
  }, [protectEditor]);
  return <div className="flex flex-wrap items-center gap-3 text-xs text-ink-500">
    <span>Stanje u {observedAt} · Beograd</span>
    <Button type="button" variant="outline" size="sm" disabled={pending || dirty} onClick={() => startTransition(() => router.refresh())}>
      {pending ? "Osvežavam…" : "Osveži rezultate"}
    </Button>
    {dirty ? <span>Prvo sačuvajte izmene kampanje.</span> : null}
  </div>;
}
