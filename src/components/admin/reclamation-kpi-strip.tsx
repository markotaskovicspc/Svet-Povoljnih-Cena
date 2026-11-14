import type { ReclamationMetrics } from "@/lib/admin/reclamation-analytics";

const integer = (value: number) => value.toLocaleString("sr-Latn-RS");

function Cell({
  label,
  value,
  hint,
  tone = "text-ink-900",
  className = "",
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  tone?: string;
  className?: string;
}) {
  return (
    <div className={`flex min-w-0 flex-col gap-0.5 border-border/60 px-4 py-2.5 ${className}`}>
      <span className="text-[10.5px] uppercase tracking-[0.14em] text-ink-500">{label}</span>
      <span className={`text-[22px] font-bold leading-tight tabular-nums ${tone}`}>{value}</span>
      {hint ? <span className="truncate text-[11.5px] text-ink-500">{hint}</span> : null}
    </div>
  );
}

function AgeChip({ days, count, danger }: { days: number; count: number; danger?: boolean }) {
  const tone = count === 0
    ? "bg-muted text-ink-500"
    : danger
      ? "bg-danger/15 text-danger"
      : "bg-warning/15 text-warning";
  return (
    <span className={`inline-flex h-[26px] items-center gap-1.5 rounded-md px-2.5 text-xs font-semibold ${tone}`}>
      {days} dana <span className="tabular-nums text-ink-900">{integer(count)}</span>
    </span>
  );
}

/** Kompaktni ukupni pokazatelji (isti kao na stranici Reklamacije – izveštaji) za zaglavlje dnevnika. */
export function ReclamationKpiStrip({ totals, untasked }: { totals: ReclamationMetrics; untasked?: number }) {
  const average = totals.averageResolutionDays;
  return (
    <section
      aria-label="Pokazatelji reklamacija"
      className="flex flex-wrap overflow-hidden rounded-xl border border-border/60 bg-surface"
    >
      <Cell
        className="flex-[1_1_150px] border-r"
        label="Ukupno"
        value={integer(totals.total)}
        hint={`${integer(totals.deliveredItems)} isporučenih art.`}
      />
      <Cell
        className="flex-[1_1_130px] border-r"
        label="% reklamacija"
        value={`${totals.reclamationRate.toLocaleString("sr-Latn-RS", { minimumFractionDigits: 1, maximumFractionDigits: 2 })}%`}
        hint="rekl. / isporučeno"
      />
      <Cell
        className="flex-[1_1_130px] border-r"
        label="Rešene"
        value={integer(totals.resolved)}
        tone="text-success"
        hint="uklj. odbijene"
      />
      <div className="flex min-w-0 flex-[3_1_380px] flex-wrap items-center gap-x-5 border-r border-border/60 bg-muted/30">
        <Cell
          label="Nerešene"
          value={integer(totals.unresolved)}
          tone={totals.unresolved > 0 ? "text-warning" : "text-ink-900"}
          hint={untasked ? (
            <>
              <span className="font-semibold text-danger" title="Otvorene reklamacije bez naloga magacinu ili kuriru">{integer(untasked)} neobrađen{untasked === 1 ? "a" : "e"}</span>
            </>
          ) : "primljene i u obradi"}
        />

        <div className="flex min-w-0 flex-col gap-1.5 px-4 py-2.5">
          <span className="text-[10.5px] uppercase tracking-[0.14em] text-ink-500">Otvorene duže od</span>
          <div className="flex flex-wrap gap-1.5">
            <AgeChip days={5} count={totals.unresolvedOver5Days} />
            <AgeChip days={10} count={totals.unresolvedOver10Days} />
            <AgeChip days={20} count={totals.unresolvedOver20Days} danger />
            <AgeChip days={30} count={totals.unresolvedOver30Days} danger />
          </div>
        </div>
      </div>
      <Cell
        className="flex-[1_1_150px]"
        label="Prosečno rešavanje"
        value={average === null ? "—" : (
          <>
            {average.toLocaleString("sr-Latn-RS", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}{" "}
            <span className="text-sm font-semibold text-ink-500">dana</span>
          </>
        )}
        hint="od prijema do zatvaranja"
      />
    </section>
  );
}
