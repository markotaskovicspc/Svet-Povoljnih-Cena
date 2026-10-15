import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";

/** Keep secondary dashboard controls compact so today's sales fit on a phone. */
export function DashboardDisclosure({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="group rounded-xl border border-border/70 bg-surface">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-4 py-2 text-sm font-medium [&::-webkit-details-marker]:hidden">
        {title}<ChevronDown className="size-4 transition group-open:rotate-180" aria-hidden />
      </summary>
      <div className="space-y-4 border-t border-border/60 p-3 sm:p-4">{children}</div>
    </details>
  );
}
