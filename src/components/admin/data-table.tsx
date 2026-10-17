import { cn } from "@/lib/utils";

export function DataTable({
  columns,
  rows,
  empty = "Nema podataka.",
  className,
  stickyHeader = false,
}: {
  columns: { key: string; label: string; sortHref?: string; sortDirection?: "asc" | "desc"; align?: "left" | "right" | "center" }[];
  rows: { id: string; cells: Record<string, React.ReactNode> }[];
  empty?: string;
  className?: string;
  stickyHeader?: boolean;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border/80 bg-surface p-10 text-center text-sm text-ink-500">
        {empty}
      </div>
    );
  }
  return (
    <div
      className={cn(
        "overflow-hidden rounded-2xl border border-border/60 bg-surface",
        className,
      )}
    >
      <div className={cn("overflow-x-auto", stickyHeader && "max-h-[70vh] overflow-y-auto overscroll-contain print:max-h-none print:overflow-visible")}
        role={stickyHeader ? "region" : undefined}
        aria-label={stickyHeader ? "Tabela artikala — pomeranje horizontalno i vertikalno" : undefined}
        tabIndex={stickyHeader ? 0 : undefined}>
        <table className={cn("min-w-full text-sm", stickyHeader && "min-w-[1800px]")}>
          <thead className="bg-muted-bg/60 text-xs uppercase tracking-[0.14em] text-ink-500">
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  aria-sort={c.sortHref ? c.sortDirection === "asc" ? "ascending" : c.sortDirection === "desc" ? "descending" : "none" : undefined}
                  className={cn(
                    "whitespace-normal px-4 py-3 text-left font-medium",
                    stickyHeader && "sticky top-0 z-10 bg-muted-bg shadow-sm print:static",
                    c.align === "right" && "text-right",
                    c.align === "center" && "text-center",
                  )}
                >
                  <span title={c.label} className={cn("max-w-48 break-words leading-4", stickyHeader ? "block min-w-24" : "line-clamp-3")}>{c.sortHref ? <a href={c.sortHref} className="hover:text-walnut">{c.label}{c.sortDirection ? c.sortDirection === "asc" ? " ↑" : " ↓" : " ↕"}</a> : c.label}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {rows.map((row) => (
              <tr key={row.id} className="hover:bg-muted-bg/30">
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={cn(
                      "px-4 py-3 align-middle text-ink-700",
                      c.align === "right" && "text-right",
                      c.align === "center" && "text-center",
                    )}
                  >
                    {row.cells[c.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
