import ExcelJS from "exceljs";
import { requireAdminAction } from "@/lib/admin";
import { resolveReportPeriod } from "@/lib/admin/report-period";
import {
  getAnalyticsFunnelSummary,
  getDailyVisitsReport,
  getPageConversionReport,
  normalizeAnalyticsGranularity,
} from "@/lib/admin/analytics-report.server";

const XLSX_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function styleHeader(row: ExcelJS.Row) {
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF2F2924" },
    };
  });
}

export async function GET(request: Request) {
  await requireAdminAction(["ADS"]);
  const search = new URL(request.url).searchParams;
  const period = resolveReportPeriod({
    range: search.get("range") ?? undefined,
    from: search.get("from") ?? undefined,
    to: search.get("to") ?? undefined,
  });
  const granularity = normalizeAnalyticsGranularity(
    search.get("group") ?? undefined,
  );
  const [summary, rows, dailyRows] = await Promise.all([
    getAnalyticsFunnelSummary(period),
    getPageConversionReport(period, granularity),
    getDailyVisitsReport(period),
  ]);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Svet povoljnih cena ERP";
  workbook.created = new Date();

  const daily = workbook.addWorksheet("Posete po danu", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  daily.columns = [
    { header: "Dan", key: "day", width: 16 },
    { header: "Ukupno poseta", key: "visits", width: 20 },
    { header: "Pregledi stranica", key: "pageViews", width: 22 },
  ];
  daily.addRows(dailyRows);
  styleHeader(daily.getRow(1));
  daily.getCell("A1").note = "Kalendarski dan po vremenu u Srbiji. Današnji podaci još nisu konačni.";
  daily.getCell("B1").note = "Ista sesija računa se jednom dnevno na celom sajtu. Samo posete uz saglasnost za analitiku.";
  daily.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: Math.max(1, dailyRows.length + 1), column: 3 },
  };
  daily.getColumn("visits").numFmt = "#,##0";
  daily.getColumn("pageViews").numFmt = "#,##0";

  const overview = workbook.addWorksheet("Sažetak");
  overview.columns = [
    { header: "Pokazatelj", key: "metric", width: 32 },
    { header: "Vrednost", key: "value", width: 22 },
  ];
  overview.addRows([
    { metric: "Period", value: period.label },
    { metric: "Jedinstveni posetioci", value: summary.visitors },
    { metric: "Kupci", value: summary.purchasers },
    {
      metric: "Poseta → kupovina (%)",
      value: summary.visitors
        ? (summary.purchasers / summary.visitors) * 100
        : 0,
    },
    { metric: "Vrednost kupovina (RSD)", value: summary.purchaseValue },
    {
      metric: "Vrednost po poseti (RSD)",
      value: summary.visitors ? summary.purchaseValue / summary.visitors : 0,
    },
    { metric: "Kupci koji su dodali u korpu", value: summary.cartBuyers },
    {
      metric: "Korpa → kupovina (%)",
      value: summary.cartBuyers
        ? (summary.convertedCartBuyers / summary.cartBuyers) * 100
        : 0,
    },
  ]);
  styleHeader(overview.getRow(1));
  overview.getColumn(2).numFmt = "#,##0.00";

  const detail = workbook.addWorksheet("Stranice", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  detail.columns = [
    { header: "Period", key: "bucket", width: 14 },
    { header: "Stranica", key: "path", width: 52 },
    { header: "Pregledi", key: "pageViews", width: 14 },
    { header: "Jedinstvene posete", key: "visits", width: 20 },
    { header: "Kupovine", key: "purchases", width: 14 },
    { header: "Konverzija (%)", key: "conversionPct", width: 18 },
    { header: "Vrednost (RSD)", key: "purchaseValue", width: 20 },
  ];
  detail.addRows(rows);
  styleHeader(detail.getRow(1));
  detail.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: Math.max(1, rows.length + 1), column: detail.columns.length },
  };
  detail.getColumn("conversionPct").numFmt = "0.00";
  detail.getColumn("purchaseValue").numFmt = "#,##0.00";

  const buffer = await workbook.xlsx.writeBuffer();
  return new Response(new Uint8Array(buffer), {
    headers: {
      "content-type": XLSX_TYPE,
      "content-disposition": `attachment; filename="posete-konverzije-${period.fromInput}-${period.toInput}.xlsx"`,
      "cache-control": "private, no-store",
    },
  });
}
