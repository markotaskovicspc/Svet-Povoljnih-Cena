import Link from "next/link";
import { db } from "@/lib/db";
import { getAnanasSummary } from "@/lib/ananas/report";
import type { ReportPeriod } from "@/lib/admin/report-period";
import { formatRsd } from "@/lib/format";
import { Card, CardTitle, StatCard } from "./card";

export async function AnanasSummary({ period }: { period: ReportPeriod }) {
  const [summary, last] = await Promise.all([
    getAnanasSummary(period.start, period.endExclusive),
    db.ananasSyncRun.findFirst({ where: { status: "SUCCESS", source: { in: ["AUTO", "MANUAL"] } }, orderBy: { finishedAt: "desc" } }),
  ]);
  return <Card>
    <CardTitle description={`Datum fiskalnog računa · ${period.label} · Svi Ananas magacini`}>Ananas</CardTitle>
    <p className="mb-4 text-sm text-ink-500">Izdvojeni kanal prodaje. Iznosi obuhvataju preuzete račune i nisu dodati SPC fiskalnom zbiru. Ovo nije obračun dobiti ili Ananas isplate.</p>
    {last ? <>
      <div className="grid gap-4 md:grid-cols-3">
        <StatCard label="Izdati računi" value={formatRsd(summary.gross)} hint={`${summary.sales} dokumenata · sa PDV-om`} />
        <StatCard label="Refundacije" value={formatRsd(summary.corrections)} hint={`${summary.refunds} dokumenata · sa PDV-om`} />
        <StatCard label="Promet posle refundacija" value={formatRsd(summary.afterCorrections)} hint={`PDV nakon refundacija: ${formatRsd(summary.vat)}`} />
      </div>
      <p className="mt-4 text-xs text-ink-500">Poslednji uspešan uvoz: {last.finishedAt?.toLocaleString("sr-Latn-RS", { timeZone: "Europe/Belgrade" })}. Pokriveni period: {last.from.toLocaleDateString("sr-Latn-RS", { timeZone: "Europe/Belgrade" })} – {new Date(last.to.getTime() - 1).toLocaleDateString("sr-Latn-RS", { timeZone: "Europe/Belgrade" })}. Starije periode uvezite zasebno.</p>
    </> : <p className="text-sm">Još nema uspešno preuzetih podataka. Prikaz prometa biće dostupan nakon povezivanja.</p>}
    <Link className="mt-4 inline-block text-sm font-medium underline" href={`/admin/erp/ananas?from=${period.fromInput}&to=${period.toInput}`}>Računi i status povezivanja →</Link>
  </Card>;
}
