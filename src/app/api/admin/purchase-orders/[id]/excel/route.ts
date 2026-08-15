import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { requireAdminAction } from "@/lib/admin";
import { db } from "@/lib/db";
import { MERCHANT_LEGAL_INFO } from "@/lib/merchant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function dateOnly(value: Date | null) {
  return value?.toLocaleDateString("sr-Latn-RS", {
    timeZone: "Europe/Belgrade",
  }) ?? "—";
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  await requireAdminAction(["OPS"]);
  const { id } = await context.params;
  const order = await db.purchaseOrder.findUnique({
    where: { id },
    include: {
      supplier: true,
      loadingLocation: true,
      items: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!order) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Svet povoljnih cena ERP";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet("ORDER REQUEST", {
    views: [{ state: "frozen", ySplit: 16 }],
    pageSetup: {
      orientation: "landscape",
      paperSize: 9,
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: {
        left: 0.2,
        right: 0.2,
        top: 0.35,
        bottom: 0.35,
        header: 0.1,
        footer: 0.1,
      },
    },
  });

  const widths = [
    22, 14, 24, 22, 16, 21, 14, 14, 15, 16, 16, 20, 16, 18,
  ];
  widths.forEach((width, index) => {
    sheet.getColumn(index + 1).width = width;
  });

  sheet.mergeCells("A1:J2");
  sheet.getCell("A1").value = "PORUDŽBENICA / ORDER REQUEST";
  sheet.getCell("A1").font = { bold: true, size: 24 };
  sheet.getCell("A1").alignment = { vertical: "middle" };
  sheet.mergeCells("N1:N2");
  sheet.getCell("N1").value = order.number;
  sheet.getCell("N1").font = { bold: true, size: 20 };
  sheet.getCell("N1").alignment = { horizontal: "right", vertical: "middle" };
  sheet.getRow(1).height = 27;
  sheet.getRow(2).height = 27;

  const supplierAddress = [
    order.supplier?.address,
    order.supplier?.city,
    order.supplier?.country,
  ]
    .filter(Boolean)
    .join(", ");
  const loadingPort = [order.loadingLocation?.name, order.loadingLocation?.city]
    .filter(Boolean)
    .join(", ");
  const metadata: Array<[string, string]> = [
    ["Datum porudžbine / Order date", dateOnly(order.orderDate ?? order.createdAt)],
    ["Kupac / Buyer", MERCHANT_LEGAL_INFO.name.toUpperCase()],
    ["Adresa kupca / Buyer address", MERCHANT_LEGAL_INFO.shortAddress],
    ["PIB kupca / Tax number", MERCHANT_LEGAL_INFO.pib],
    ["Paritet / Incoterm", order.parity ?? "—"],
    ["Prodavac / Seller", order.supplier?.name ?? "—"],
    ["Adresa prodavca / Seller address", supplierAddress || "—"],
    [
      "1. Uslovi plaćanja / Terms of payment",
      order.supplier?.paymentTerms ?? "—",
    ],
    ["2. Datum utovara / Loading date", dateOnly(order.loadingDate)],
    ["3. Luka utovara / Port of loading", loadingPort || "—"],
  ];
  metadata.forEach(([label, value], index) => {
    const row = index + 4;
    sheet.mergeCells(row, 1, row, 4);
    sheet.mergeCells(row, 5, row, 14);
    sheet.getCell(row, 1).value = label;
    sheet.getCell(row, 1).font = { bold: true, size: 11 };
    sheet.getCell(row, 5).value = value;
    sheet.getCell(row, 5).font = { size: 11 };
  });

  const tableRow = 16;
  const headers = [
    "Naziv artikla dobavljača / Item name of producer",
    "SPC šifra artikla / SPC item code",
    "Naziv artikla Svet povoljnih cena / SPC item name",
    "Naziv artikla ili fotografija / Item name or photo",
    "Boja / Color",
    "Način pakovanja / Packaging",
    "Broj kutija / CTN quantity",
    "Količina / Quantity",
    "Jedinica mere / Unit",
    "Ukupna zapremina / Total CBM",
    "Sertifikati / Certificates",
    "Bar kod / Barcode",
    `Cena po jedinici (${order.currency}) / Price per unit`,
    `Ukupna cena (${order.currency}) / Total price`,
  ];
  const headerRow = sheet.getRow(tableRow);
  headerRow.values = headers;
  headerRow.height = 66;
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, size: 9 };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFF2F2F2" },
    };
    cell.alignment = {
      horizontal: "center",
      vertical: "middle",
      wrapText: true,
    };
  });

  const totalRowNumber = tableRow + 1;
  const totalCartons = order.items.reduce(
    (sum, item) => sum + Math.ceil(item.qty / Math.max(item.packQty ?? 1, 1)),
    0,
  );
  const totalQty = order.items.reduce((sum, item) => sum + item.qty, 0);
  sheet.mergeCells(totalRowNumber, 1, totalRowNumber, 6);
  sheet.getCell(totalRowNumber, 1).value = "Ukupno / Total";
  sheet.getCell(totalRowNumber, 1).alignment = { horizontal: "right" };
  sheet.getCell(totalRowNumber, 7).value = totalCartons;
  sheet.getCell(totalRowNumber, 8).value = totalQty;
  sheet.getCell(totalRowNumber, 10).value = Number(order.totalVolume ?? 0);
  sheet.mergeCells(totalRowNumber, 11, totalRowNumber, 12);
  sheet.getCell(totalRowNumber, 11).value = "Ukupno za plaćanje / Total payment";
  sheet.mergeCells(totalRowNumber, 13, totalRowNumber, 14);
  sheet.getCell(totalRowNumber, 13).value = Number(order.totalPrice);
  sheet.getCell(totalRowNumber, 13).numFmt = `#,##0.00 "${order.currency}"`;
  sheet.getRow(totalRowNumber).font = { bold: true, size: 10 };

  order.items.forEach((item, index) => {
    const row = sheet.getRow(tableRow + 2 + index);
    row.values = [
      item.supplierProductName ?? item.sku,
      item.sku,
      item.name,
      item.name,
      item.pattern ?? "—",
      `${item.packQty ?? 1} pcs/box`,
      Math.ceil(item.qty / Math.max(item.packQty ?? 1, 1)),
      item.qty,
      "piece / kom",
      Number(item.totalVolume ?? 0),
      item.certificates ?? "—",
      item.barcode ?? "—",
      Number(item.purchasePrice),
      Number(item.purchasePrice) * item.qty,
    ];
    row.height = 52;
    row.eachCell((cell) => {
      cell.alignment = {
        horizontal: "center",
        vertical: "middle",
        wrapText: true,
      };
    });
    row.getCell(10).numFmt = "#,##0.000";
    row.getCell(13).numFmt = "#,##0.00";
    row.getCell(14).numFmt = "#,##0.00";
  });

  const lastRow = tableRow + 1 + order.items.length;
  for (let row = tableRow; row <= lastRow; row += 1) {
    for (let column = 1; column <= 14; column += 1) {
      sheet.getCell(row, column).border = {
        top: { style: "thin", color: { argb: "FF202020" } },
        left: { style: "thin", color: { argb: "FF202020" } },
        bottom: { style: "thin", color: { argb: "FF202020" } },
        right: { style: "thin", color: { argb: "FF202020" } },
      };
    }
  }
  sheet.autoFilter = {
    from: { row: tableRow, column: 1 },
    to: { row: lastRow, column: 14 },
  };
  sheet.pageSetup.printArea = `A1:N${lastRow}`;
  sheet.headerFooter.oddFooter = "Strana &P / &N";

  const buffer = await workbook.xlsx.writeBuffer();
  return new Response(new Uint8Array(buffer), {
    headers: {
      "content-type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="porudzbenica-${order.number.replaceAll("/", "-")}.xlsx"`,
      "cache-control": "private, no-store",
    },
  });
}
