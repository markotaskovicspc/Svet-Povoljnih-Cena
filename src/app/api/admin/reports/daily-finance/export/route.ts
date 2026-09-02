import ExcelJS from "exceljs";
import { requireAdminAction } from "@/lib/admin";
import { resolveReportPeriod } from "@/lib/admin/report-period";
import {
  getDailyFinanceReport,
  summarizeDailyFinanceReport,
} from "@/lib/admin/daily-finance-report.server";

export async function GET(request: Request) {
  await requireAdminAction(["OPS"]);
  const search = new URL(request.url).searchParams;
  const period = resolveReportPeriod({
    range: search.get("range") ?? undefined,
    from: search.get("from") ?? undefined,
    to: search.get("to") ?? undefined,
  });
  const rows = await getDailyFinanceReport(period);
  const total = summarizeDailyFinanceReport(rows);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Svet povoljnih cena ERP";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet("Dnevni promet", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  sheet.columns = [
    { header: "Datum", key: "day", width: 14 },
    { header: "Broj profaktura", key: "proformaCount", width: 18 },
    { header: "Profakture ukupno", key: "proformaGross", width: 22 },
    { header: "Broj fiskalnih računa", key: "fiscalSaleCount", width: 24 },
    { header: "Fiskalizovano", key: "fiscalSaleGross", width: 20 },
    { header: "Broj refundacija", key: "fiscalRefundCount", width: 20 },
    { header: "Refundirano", key: "fiscalRefundGross", width: 18 },
    { header: "Neto fiskalizovano", key: "fiscalNetGross", width: 22 },
  ];
  sheet.addRows(rows);
  sheet.addRow({
    day: "UKUPNO",
    ...total,
  });
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: Math.max(1, rows.length + 1), column: sheet.columns.length },
  };
  sheet.getRow(1).eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF2F2924" },
    };
  });
  sheet.getRow(rows.length + 2).font = { bold: true };
  for (const column of [3, 5, 7, 8]) {
    sheet.getColumn(column).numFmt = "#,##0.00";
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return new Response(new Uint8Array(buffer), {
    headers: {
      "content-type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="dnevni-promet-${period.fromInput}-${period.toInput}.xlsx"`,
      "cache-control": "private, no-store",
    },
  });
}
