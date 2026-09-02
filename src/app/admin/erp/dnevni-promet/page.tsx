import Link from "next/link";
import { requireAdminAction } from "@/lib/admin";
import { formatRsd } from "@/lib/format";
import { REPORT_PERIOD_PRESETS, resolveReportPeriod } from "@/lib/admin/report-period";
import {
  getDailyFinanceReport,
  summarizeDailyFinanceReport,
} from "@/lib/admin/daily-finance-report.server";
import { PageHeader } from "@/components/admin/page-header";
import { Card, CardTitle, StatCard } from "@/components/admin/card";
import { DataTable } from "@/components/admin/data-table";
import { Input } from "@/components/ui/input";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Dnevni promet · ERP",
  robots: { index: false, follow: false },
};

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function DailyFinanceReportPage({
  searchParams,
}: {
  searchParams: Promise<{
    range?: string | string[];
    from?: string | string[];
    to?: string | string[];
  }>;
}) {
  await requireAdminAction(["OPS"]);
  const params = await searchParams;
  const period = resolveReportPeriod({
    range: first(params.range),
    from: first(params.from),
    to: first(params.to),
  });
  const rows = await getDailyFinanceReport(period);
  const total = summarizeDailyFinanceReport(rows);
  const exportHref = `/api/admin/reports/daily-finance/export?range=${encodeURIComponent(period.preset)}&from=${period.fromInput}&to=${period.toInput}`;

  return (
    <>
      <PageHeader
        title="Dnevni zbir profaktura i fiskalizacije"
        description="Dnevni broj i iznosi izdatih profaktura, fiskalnih računa i refundacija."
        crumbs={[
          { href: "/admin", label: "Admin" },
          { href: "/admin/izvestaji", label: "Izveštajni centar" },
          { label: "Dnevni promet" },
        ]}
      />
      <div className="space-y-6 px-4 py-6 md:px-8">
        <form method="get" className="grid gap-3 rounded-xl border border-border/60 bg-surface p-4 md:grid-cols-4">
          <label className="text-xs font-medium text-ink-600">
            Period
            <select name="range" defaultValue={period.preset} className="mt-1 h-9 w-full rounded-lg border border-border bg-white px-3 text-sm">
              {REPORT_PERIOD_PRESETS.map((preset) => (
                <option key={preset.key} value={preset.key}>{preset.label}</option>
              ))}
              <option value="custom">Tačan raspon</option>
            </select>
          </label>
          <label className="text-xs font-medium text-ink-600">
            Od
            <Input name="from" type="date" defaultValue={period.fromInput} className="mt-1 h-9" />
          </label>
          <label className="text-xs font-medium text-ink-600">
            Do
            <Input name="to" type="date" defaultValue={period.toInput} className="mt-1 h-9" />
          </label>
          <div className="flex items-end gap-2">
            <button className="h-9 rounded-lg bg-walnut px-4 text-sm font-medium text-white">Primeni</button>
            <Link href={exportHref} className="inline-flex h-9 items-center rounded-lg border border-border px-4 text-sm font-medium text-ink-700">Excel</Link>
          </div>
        </form>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Profakture" value={String(total.proformaCount)} hint={`${formatRsd(total.proformaGross)} · ${period.label}`} />
          <StatCard label="Fiskalni računi" value={String(total.fiscalSaleCount)} hint={`${formatRsd(total.fiscalSaleGross)} · ${period.label}`} />
          <StatCard label="Fiskalne refundacije" value={String(total.fiscalRefundCount)} hint={`−${formatRsd(total.fiscalRefundGross)} · ${period.label}`} />
          <StatCard label="Neto fiskalizovano" value={formatRsd(total.fiscalNetGross)} hint={period.label} />
        </div>

        <Card>
          <CardTitle description={period.label}>Dnevni pregled</CardTitle>
          <DataTable
            columns={[
              { key: "day", label: "Datum" },
              { key: "proformaCount", label: "Profaktura", align: "right" },
              { key: "proformaGross", label: "Profakture ukupno", align: "right" },
              { key: "saleCount", label: "Fiskalnih računa", align: "right" },
              { key: "saleGross", label: "Fiskalizovano", align: "right" },
              { key: "refundCount", label: "Refundacija", align: "right" },
              { key: "refundGross", label: "Refundirano", align: "right" },
              { key: "net", label: "Neto fiskalizovano", align: "right" },
            ]}
            rows={rows.map((row) => ({
              id: row.day,
              cells: {
                day: row.day,
                proformaCount: row.proformaCount,
                proformaGross: formatRsd(row.proformaGross),
                saleCount: row.fiscalSaleCount,
                saleGross: formatRsd(row.fiscalSaleGross),
                refundCount: row.fiscalRefundCount,
                refundGross: formatRsd(row.fiscalRefundGross),
                net: formatRsd(row.fiscalNetGross),
              },
            }))}
            empty="Nema profaktura ni fiskalnih dokumenata u izabranom periodu."
          />
        </Card>
      </div>
    </>
  );
}
