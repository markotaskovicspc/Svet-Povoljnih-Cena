import { cn } from "@/lib/utils";

export function DataTable({
  columns,
  rows,
  empty = "Nema podataka.",
  className,
}: {
  columns: { key: string; label: string; align?: "left" | "right" | "center" }[];
  rows: { id: string; cells: Record<string, React.ReactNode> }[];
  empty?: string;
  className?: string;
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
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-muted-bg/60 text-xs uppercase tracking-[0.14em] text-ink-500">
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  className={cn(
                    "whitespace-nowrap px-4 py-3 text-left font-medium",
                    c.align === "right" && "text-right",
                    c.align === "center" && "text-center",
                  )}
                >
                  {c.label}
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
