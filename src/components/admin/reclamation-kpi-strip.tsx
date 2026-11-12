import type { ReclamationMetrics } from "@/lib/admin/reclamation-analytics";

const integer = (value: number) => value.toLocaleString("sr-Latn-RS");

function Item({ label, children, title }: { label: string; children: React.ReactNode; title?: string }) {
  return (
    <div className="flex min-w-0 flex-col justify-center gap-0.5 px-3 py-1" title={title}>
      <span className="whitespace-nowrap text-[10px] uppercase tracking-[0.12em] text-ink-500">{label}</span>
      <span className="flex items-baseline gap-1.5 whitespace-nowrap text-base font-bold leading-tight tabular-nums text-ink-900">
        {children}
      </span>
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
    <span className={`inline-flex h-5 items-center gap-1 rounded px-1.5 text-[11px] font-semibold ${tone}`}>
      {days}d <span className="tabular-nums text-ink-900">{integer(count)}</span>
    </span>
  );
}

/** Sažeti ukupni pokazatelji (isti kao na stranici Reklamacije – izveštaji) u redu sa naslovom dnevnika. */
export function ReclamationKpiStrip({ totals }: { totals: ReclamationMetrics }) {
  const average = totals.averageResolutionDays;
  const rate = `${totals.reclamationRate.toLocaleString("sr-Latn-RS", { minimumFractionDigits: 1, maximumFractionDigits: 2 })}%`;
  return (
    <section
      aria-label="Pokazatelji reklamacija"
      className="flex flex-wrap items-stretch divide-x divide-border/60 rounded-lg border border-border/60 bg-surface"
    >
      <Item
        label="Reklamacije · %"
        title={`${integer(totals.total)} reklamacija na ${integer(totals.deliveredItems)} isporučenih artikala`}
      >
        {integer(totals.total)}
        <span className="text-ink-500">·</span>
        {rate}
      </Item>
      <Item label="Rešene / nerešene" title="Rešene uključuju i odbijene; nerešene su primljene i u obradi">
        <span className="text-success">{integer(totals.resolved)}</span>
        <span className="text-xs font-semibold text-ink-500">/</span>
        <span className={totals.unresolved > 0 ? "text-warning" : undefined}>{integer(totals.unresolved)}</span>
      </Item>
      <div className="flex min-w-0 flex-col justify-center gap-1 px-3 py-1" title="Nerešene reklamacije otvorene duže od 5, 10, 20 i 30 dana">
        <span className="whitespace-nowrap text-[10px] uppercase tracking-[0.12em] text-ink-500">Otvorene duže od</span>
        <span className="flex flex-wrap gap-1">
          <AgeChip days={5} count={totals.unresolvedOver5Days} />
          <AgeChip days={10} count={totals.unresolvedOver10Days} />
          <AgeChip days={20} count={totals.unresolvedOver20Days} danger />
          <AgeChip days={30} count={totals.unresolvedOver30Days} danger />
        </span>
      </div>
      <Item label="Prosek rešavanja" title="Od prijema do zatvaranja reklamacije">
        {average === null ? "—" : (
          <>
            {average.toLocaleString("sr-Latn-RS", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
            <span className="text-xs font-semibold text-ink-500">dana</span>
          </>
        )}
      </Item>
    </section>
  );
}
