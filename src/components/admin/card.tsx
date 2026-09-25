import { cn } from "@/lib/utils";

export function Card({
  className,
  children,
  id,
}: {
  className?: string;
  children: React.ReactNode;
  id?: string;
}) {
  return (
    <div
      id={id}
      className={cn(
        "rounded-2xl border border-border/60 bg-surface p-6 shadow-sm",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function CardTitle({
  children,
  description,
}: {
  children: React.ReactNode;
  description?: string;
}) {
  return (
    <div className="mb-4">
      <h2 className="font-display text-lg text-ink-900">{children}</h2>
      {description ? (
        <p className="mt-1 text-xs text-ink-500">{description}</p>
      ) : null}
    </div>
  );
}

export function StatCard({
  label,
  value,
  amount,
  hint,
  breakdown,
  tone = "default",
}: {
  label: string;
  value: string;
  amount?: string;
  hint?: string;
  breakdown?: { label: string; value: string }[];
  tone?: "default" | "success" | "warning" | "danger";
}) {
  const toneCls =
    tone === "success"
      ? "text-success"
      : tone === "warning"
        ? "text-warning"
        : tone === "danger"
          ? "text-danger"
          : "text-ink-900";
  return (
    <Card>
      <p className="text-xs uppercase tracking-[0.18em] text-ink-500">
        {label}
      </p>
      <p
        className={cn(
          "mt-2 font-display text-3xl tracking-tight",
          toneCls,
        )}
      >
        {value}
      </p>
      {amount ? (
        <p className="mt-2 text-2xl font-semibold leading-tight tabular-nums text-ink-900">
          {amount}
        </p>
      ) : null}
      {breakdown?.length ? <dl className="mt-4 space-y-2 border-t border-border/60 pt-3 text-sm">
        {breakdown.map(row => <div key={row.label} className="flex flex-wrap justify-between gap-x-3 gap-y-1">
          <dt className="text-ink-500">{row.label}</dt>
          <dd className="font-medium tabular-nums text-ink-900">{row.value}</dd>
        </div>)}
      </dl> : null}
      {hint ? <p className="mt-1 text-xs text-ink-500">{hint}</p> : null}
    </Card>
  );
}
