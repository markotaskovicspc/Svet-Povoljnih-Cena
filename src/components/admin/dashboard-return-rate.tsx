import type { DashboardReturnSummary } from "@/lib/admin/dashboard-returns";
import { StatCard } from "./card";

export function DashboardReturnRate({ summary, warehouseLabel }: {
  summary: DashboardReturnSummary;
  warehouseLabel: string;
}) {
  const rate = summary.sent > 0
    ? `${(summary.returned / summary.sent * 100).toLocaleString("sr-Latn-RS", { maximumFractionDigits: 2 })}%`
    : "—";
  return <StatCard label="Povrati · poslednjih 30 dana" value={rate}
    amount={`${summary.returned.toLocaleString("sr-Latn-RS")} / ${summary.sent.toLocaleString("sr-Latn-RS")} komada`}
    hint={`${warehouseLabel} · Vraćeni komadi / poslati komadi, za porudžbine prvi put poslate u poslednjih 30 dana. Uključeni odbijeni paketi, delimični povrati i reklamacije. Isti komad se ne duplira kroz kurirski status i prijem u magacin. Samo evidentirana slanja.${summary.sent ? "" : " Nema evidentiranih slanja u periodu."}`}
  />;
}
