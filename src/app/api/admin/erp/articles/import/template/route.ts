import ExcelJS from "exceljs";
import { requireAdminAction } from "@/lib/admin";
import { ARTICLE_IMPORT_TEMPLATE_HEADERS } from "@/lib/admin/article-import-workbook";

const REQUIRED_NEW_ARTICLE_HEADERS = new Set([
  "Dobavljač",
  "Kategorija",
  "Kratki naziv",
  "Opis za sajt",
  "Širina artikla",
  "Dubina artikla",
  "Visina artikla",
  "Bruto težina artikla",
  "Broj artikala u pakovanju",
  "Širina transportnog pakovanja",
  "Dubina transportnog pakovanja",
  "Visina transportnog pakovanja",
  "Bruto težina transportnog pakovanja",
  "Tarifni broj",
  "Zemlja porekla",
  "MPC",
]);

export async function GET() {
  await requireAdminAction(["CONTENT"]);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Svet povoljnih cena";
  workbook.created = new Date();

  const worksheet = workbook.addWorksheet("Artikli", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  worksheet.addRow([...ARTICLE_IMPORT_TEMPLATE_HEADERS]);
  worksheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: ARTICLE_IMPORT_TEMPLATE_HEADERS.length },
  };
  worksheet.getRow(1).height = 34;
  worksheet.getRow(1).eachCell((cell, column) => {
    const header = ARTICLE_IMPORT_TEMPLATE_HEADERS[column - 1];
    const required = header ? REQUIRED_NEW_ARTICLE_HEADERS.has(header) : false;
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: required ? "FFB45309" : "FF1D4ED8" },
    };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border = {
      bottom: { style: "thin", color: { argb: "FFFFFFFF" } },
    };
  });
  worksheet.columns.forEach((column, index) => {
    const header = ARTICLE_IMPORT_TEMPLATE_HEADERS[index] ?? "";
    column.width = Math.min(Math.max(header.length + 4, 14), 38);
  });

  const instructions = workbook.addWorksheet("Uputstvo");
  instructions.columns = [{ width: 28 }, { width: 95 }];
  instructions.addRows([
    ["Tema", "Uputstvo"],
    [
      "Obavezna polja",
      "Narandžaste kolone su obavezne za novi artikal. Šifra nije obavezna: sistem je dodeljuje automatski ako je prazna.",
    ],
    [
      "Zemlja i tarifa",
      "Popunite kolonu „Tarifni broj“. Zemlja porekla iz datoteke ima prednost; ako kolona nije prisutna, sistem čuva postojeću vrednost, a kada je nema koristi zemlju iz kartice dobavljača.",
    ],
    [
      "List i zaglavlje",
      "List Artikli ne mora biti prvi, a zaglavlje ne mora biti u prvom redu. Preview prikazuje šta je sistem prepoznao.",
    ],
    [
      "Postojeći SKU",
      "Kod izmene postojećeg SKU-a menjaju se samo kolone koje postoje u datoteci; ostali podaci ostaju nepromenjeni.",
    ],
    [
      "Bezbedan uvoz",
      "Prvo pokrenite preview. Uvoz je atomski: ako bilo koji red nije ispravan, nijedan red neće biti upisan.",
    ],
  ]);
  instructions.getRow(1).eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1D4ED8" } };
  });
  instructions.eachRow((row) => {
    row.alignment = { vertical: "top", wrapText: true };
  });

  const content = await workbook.xlsx.writeBuffer();
  return new Response(new Uint8Array(content), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition":
        'attachment; filename="spc-artikli-uvoz-sablon.xlsx"',
      "Cache-Control": "private, no-store",
    },
  });
}
