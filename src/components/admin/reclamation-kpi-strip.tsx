import type { ReclamationMetrics } from "@/lib/admin/reclamation-analytics";
import { ReclamationKpiLink } from "@/components/admin/reclamation-kpi-link";
import { reclamationKpiHref } from "@/lib/admin/reclamation-kpi-views";

const integer = (value: number) => value.toLocaleString("sr-Latn-RS");

function Cell({
  label,
  value,
  hint,
  tone = "text-ink-900",
  className = "",
  href,
  title,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  tone?: string;
  className?: string;
  href?: string;
  title?: string;
}) {
  const body = (
    <>
      <span className="text-[10.5px] uppercase tracking-[0.14em] text-ink-500">{label}</span>
      <span className={`text-[22px] font-bold leading-tight tabular-nums ${tone}`}>{value}</span>
      {hint ? <span className="truncate text-[11.5px] text-ink-500">{hint}</span> : null}
    </>
  );
  const base = `flex min-w-0 flex-col gap-0.5 border-border/60 px-4 py-2.5 ${className}`;
  return href ? (
    <ReclamationKpiLink href={href} title={title} className={`${base} transition-colors hover:bg-muted/60`}>{body}</ReclamationKpiLink>
  ) : (
    <div className={base}>{body}</div>
  );
}

function AgeChip({ days, count, danger }: { days: number; count: number; danger?: boolean }) {
  const tone = count === 0
    ? "bg-muted text-ink-500"
    : danger
      ? "bg-danger/15 text-danger"
      : "bg-warning/15 text-warning";
  return (
    <ReclamationKpiLink
      href={reclamationKpiHref(`starije-${days}` as `starije-${5 | 10 | 20 | 30}`)}
      title={`Otvorene reklamacije starije od ${days} dana`}
      className={`inline-flex h-[26px] items-center gap-1.5 rounded-md px-2.5 text-xs font-semibold transition hover:brightness-110 hover:ring-1 hover:ring-current ${tone}`}
    >
      {days} dana <span className="tabular-nums text-ink-900">{integer(count)}</span>
    </ReclamationKpiLink>
  );
}

function untaskedSuffix(count: number) {
  const lastTwo = count % 100;
  if (count % 10 === 1 && lastTwo !== 11) return "a";
  if (count % 10 >= 2 && count % 10 <= 4 && (lastTwo < 12 || lastTwo > 14)) return "e";
  return "ih";
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
        href={reclamationKpiHref("sve")}
        title="Sve reklamacije"
        value={integer(totals.total)}
        hint={`${integer(totals.deliveredItems)} isporučenih art.`}
      />
      <Cell
        className="flex-[1_1_130px] border-r"
        label="% reklamacija"
        href="/admin/erp/reklamacije-izvestaji"
        title="Izveštaji: procenat po dobavljaču i artiklu"
        value={`${totals.reclamationRate.toLocaleString("sr-Latn-RS", { minimumFractionDigits: 1, maximumFractionDigits: 2 })}%`}
        hint="rekl. / isporučeno"
      />
      <Cell
        className="flex-[1_1_130px] border-r"
        label="Rešene"
        href={reclamationKpiHref("resene")}
        title="Rešene i odbijene reklamacije"
        value={integer(totals.resolved)}
        tone="text-success"
        hint="uklj. odbijene"
      />
      <div className="flex min-w-0 flex-[3_1_380px] flex-wrap items-center gap-x-5 border-r border-border/60 bg-muted/30">
        <div className="flex min-w-0 flex-col gap-0.5 px-4 py-2.5">
          <ReclamationKpiLink href={reclamationKpiHref("neresene")} title="Primljene i u obradi" className="flex flex-col gap-0.5 rounded hover:opacity-80">
            <span className="text-[10.5px] uppercase tracking-[0.14em] text-ink-500">Nerešene</span>
            <span className={`text-[22px] font-bold leading-tight tabular-nums ${totals.unresolved > 0 ? "text-warning" : "text-ink-900"}`}>{integer(totals.unresolved)}</span>
          </ReclamationKpiLink>
          <ReclamationKpiLink
            href={reclamationKpiHref("neobradjene")}
            title="Otvorene reklamacije bez naloga magacinu ili kuriru"
            className={`truncate text-[11.5px] hover:underline ${untasked ? "font-semibold text-danger" : "text-ink-500"}`}
          >
            {integer(untasked ?? 0)} neobrađen{untaskedSuffix(untasked ?? 0)}
          </ReclamationKpiLink>
        </div>

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
        href="/admin/erp/reklamacije-izvestaji"
        title="Izveštaji: vreme rešavanja"
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
