import { financeChannel } from "@/lib/admin/daily-finance-report";
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
  const channel = financeChannel(search.get("channel"));
  const rows = await getDailyFinanceReport(period, channel);
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
    { header: "SPC neto fiskalizovano", key: "spcNetGross", width: 24 },
    { header: "Ananas neto fiskalizovano", key: "ananasNetGross", width: 26 },
    { header: "COGS prodaje", key: "fiscalSaleCogs", width: 20 },
    { header: "COGS povrata", key: "fiscalRefundCogs", width: 20 },
    { header: "Neto COGS", key: "fiscalNetCogs", width: 20 },
    { header: "SPC neto COGS", key: "spcNetCogs", width: 20 },
    { header: "Ananas neto COGS (procena)", key: "ananasNetCogs", width: 30 },
    { header: "COGS procena (kom.)", key: "estimatedCogsQty", width: 24 },
    { header: "Bez COGS (kom.)", key: "missingCogsQty", width: 22 },
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
  for (const column of [3, 5, 7, 8, 9, 10, 11, 12, 13, 14, 15]) {
    sheet.getColumn(column).numFmt = "#,##0.00";
  }

  const notes = workbook.addWorksheet("Napomene");
  notes.columns=[{header:"Obračun",key:"text",width:110}];
  notes.addRows([{text:`Kanal: ${channel}. Period: ${period.fromInput} – ${period.toInput}.`},{text:"Promet uključuje fiskalizovane usluge. Profakture su samo SPC. COGS je samo za artikle."},{text:"SPC COGS koristi sačuvanu nabavnu vrednost u trenutku fiskalizacije, kada postoji. Refundacije umanjuju COGS na dan refundacije."},{text:"Stariji SPC dokumenti i Ananas bez sačuvanog COGS-a koriste trenutnu nabavnu vrednost artikla kao procenu, a ne istorijski knjiženi trošak."},{text:"Stavke bez COGS-a nisu uključene u zbir troška. Kolone procene i nedostajućih troškova proveriti pre knjiženja."}]);
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
