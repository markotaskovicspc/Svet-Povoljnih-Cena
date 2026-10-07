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
import { financeChannel } from "@/lib/admin/daily-finance-report";
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
    channel?: string | string[];
  }>;
}) {
  await requireAdminAction(["OPS"]);
  const params = await searchParams;
  const period = resolveReportPeriod({
    range: first(params.range),
    from: first(params.from),
    to: first(params.to),
  });
  const channel = financeChannel(first(params.channel));
  const rows = await getDailyFinanceReport(period, channel);
  const total = summarizeDailyFinanceReport(rows);
  const exportHref = `/api/admin/reports/daily-finance/export?range=${encodeURIComponent(period.preset)}&from=${period.fromInput}&to=${period.toInput}&channel=${channel}`;

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
        <form method="get" className="grid gap-3 rounded-xl border border-border/60 bg-surface p-4 md:grid-cols-5">
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
            Kanal
            <select name="channel" defaultValue={channel} className="mt-1 h-9 w-full rounded-lg border border-border bg-white px-3 text-sm">
              <option value="ALL">SPC + Ananas</option>
              <option value="SPC">SPC</option>
              <option value="ANANAS">Ananas</option>
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
            <a href={exportHref} className="inline-flex h-9 items-center rounded-lg border border-border px-4 text-sm font-medium text-ink-700">Excel</a>
          </div>
        </form>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Profakture" value={String(total.proformaCount)} hint={`${formatRsd(total.proformaGross)} · ${period.label}`} />
          <StatCard label="Fiskalni računi" value={String(total.fiscalSaleCount)} hint={`${formatRsd(total.fiscalSaleGross)} · ${period.label}`} />
          <StatCard label="Fiskalne refundacije" value={String(total.fiscalRefundCount)} hint={`−${formatRsd(total.fiscalRefundGross)} · ${period.label}`} />
          <StatCard label="Neto fiskalizovano" value={formatRsd(total.fiscalNetGross)} hint={period.label} />
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <StatCard label="SPC neto fiskalizovano" value={formatRsd(total.spcNetGross)} hint={`COGS: ${formatRsd(total.spcNetCogs)}`} />
          <StatCard label="Ananas neto fiskalizovano" value={formatRsd(total.ananasNetGross)} hint={`COGS (procena): ${formatRsd(total.ananasNetCogs)}`} />
          <StatCard label="Neto COGS" value={formatRsd(total.fiscalNetCogs)} hint={`Prodaja ${formatRsd(total.fiscalSaleCogs)} · povrat ${formatRsd(total.fiscalRefundCogs)}`} />
        </div>
        <p className="text-sm text-ink-600">Promet uključuje dostavu i druge fiskalizovane usluge; COGS obuhvata samo artikle. Profakture su samo SPC. COGS refundacija umanjuje trošak na dan izdavanja refundacije.</p>
        {(total.estimatedCogsQty > 0 || total.missingCogsQty > 0) && <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-ink-700">COGS je delimično procenjen: {total.estimatedCogsQty} kom. koristi trenutnu nabavnu vrednost jer dokument nema sačuvan COGS (stariji SPC računi i Ananas). Za {total.missingCogsQty} kom. nema nabavne vrednosti; njihov trošak nije uključen. Ovaj zbir treba proveriti pre knjiženja.</p>}

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
              { key: "spcNet", label: "SPC neto", align: "right" },
              { key: "ananasNet", label: "Ananas neto", align: "right" },
              { key: "saleCogs", label: "COGS prodaje", align: "right" },
              { key: "refundCogs", label: "COGS povrata", align: "right" },
              { key: "netCogs", label: "Neto COGS", align: "right" },
              { key: "estimated", label: "COGS procena (kom.)", align: "right" },
              { key: "missing", label: "Bez COGS (kom.)", align: "right" },
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
                spcNet: formatRsd(row.spcNetGross),
                ananasNet: formatRsd(row.ananasNetGross),
                saleCogs: formatRsd(row.fiscalSaleCogs),
                refundCogs: formatRsd(row.fiscalRefundCogs),
                netCogs: formatRsd(row.fiscalNetCogs),
                estimated: row.estimatedCogsQty,
                missing: row.missingCogsQty,
              },
            }))}
            empty="Nema profaktura ni fiskalnih dokumenata u izabranom periodu."
          />
        </Card>
      </div>
    </>
  );
}
