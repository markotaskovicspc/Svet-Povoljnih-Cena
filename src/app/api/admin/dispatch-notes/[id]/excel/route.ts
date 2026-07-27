import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { requireAdminAction } from "@/lib/admin";
import { getDispatchNotePrintData } from "@/lib/admin/dispatch-note-print.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function dateOnly(value: Date | null) {
  return value?.toISOString().slice(0, 10) ?? "";
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  await requireAdminAction(["OPS"]);
  const { id } = await context.params;
  const note = await getDispatchNotePrintData(id);
  if (!note) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }
  const includePrices = note.type !== "INTERNAL" && note.showPrices;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Svet povoljnih cena ERP";
  workbook.created = new Date();

  const header = workbook.addWorksheet("Otpremnica");
  const headerRows: Array<[string, string | number | boolean]> = [
    ["Broj otpremnice", note.number],
    ["Datum otpremnice", dateOnly(note.issueDate)],
    ["Firma koja izdaje", note.issuerName],
    ["PIB izdavaoca", note.issuerPib],
    ["Matični broj izdavaoca", note.issuerRegistrationNumber],
    [
      "Adresa izdavaoca",
      `${note.issuerAddress}, ${note.issuerPostalCode} ${note.issuerCity}`,
    ],
    [
      "Magacin izdavaoca",
      `${note.sourceWarehouse.code} · ${note.sourceWarehouse.name}`,
    ],
    ["Firma koja prima", note.receiverName],
    ["PIB primaoca", note.receiverPib],
    ["Matični broj primaoca", note.receiverRegistrationNumber],
    [
      "Adresa primaoca",
      `${note.receiverAddress}, ${note.receiverPostalCode} ${note.receiverCity}`,
    ],
    [
      "Magacin primaoca",
      note.destinationWarehouse
        ? `${note.destinationWarehouse.code} · ${note.destinationWarehouse.name}`
        : "",
    ],
    ["Cene na štampi", includePrices],
    ["Proknjiženo", note.status === "POSTED"],
    ["Poslato na SEF", Boolean(note.sefSentAt)],
    ["Način otpreme", note.shipmentMethod],
    ["Prevoznik", note.carrierName ?? ""],
    ["Registarska oznaka", note.licensePlate ?? ""],
    [
      "Kurir",
      [note.courierFirstName, note.courierLastName].filter(Boolean).join(" "),
    ],
    ["Broj lične karte kurira", note.courierIdNumber ?? ""],
    ["Napomena", note.notes ?? ""],
  ];
  if (includePrices) {
    headerRows.push(
      ["Vrednost bez PDV-a", Number(note.totalNet)],
      ["PDV", Number(note.totalVat)],
      ["Vrednost sa PDV-om", Number(note.totalGross)],
      ["Valuta", note.currency],
    );
  }
  header.addRows(headerRows);
  header.getColumn(1).width = 30;
  header.getColumn(2).width = 60;
  header.getColumn(1).font = { bold: true };
  header.getColumn(2).alignment = { wrapText: true, vertical: "top" };

  const items = workbook.addWorksheet("Stavke", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  const columns: Partial<ExcelJS.Column>[] = [
    { header: "Šifra artikla", key: "sku", width: 18 },
    { header: "Podgrupa artikla", key: "subgroup", width: 22 },
    { header: "Kolekcija", key: "collection", width: 20 },
    { header: "Kratki opis artikla", key: "shortDescription", width: 40 },
    { header: "Kratki naziv artikla", key: "shortName", width: 32 },
    { header: "Atribut 1", key: "attribute1", width: 18 },
    { header: "Atribut 2", key: "attribute2", width: 18 },
    { header: "Atribut 3", key: "attribute3", width: 18 },
    { header: "Atribut 4", key: "attribute4", width: 18 },
    { header: "Boja 1", key: "color1", width: 16 },
    { header: "Boja 2", key: "color2", width: 16 },
  ];
  if (includePrices) {
    columns.push(
      { header: "Cena", key: "unitPriceGross", width: 16 },
      { header: "Bez PDV-a", key: "totalNet", width: 16 },
      { header: "PDV", key: "totalVat", width: 16 },
      { header: "Sa PDV-om", key: "totalGross", width: 16 },
    );
  }
  columns.push(
    { header: "Količina", key: "qty", width: 12 },
    { header: "Porudžbina", key: "sourceOrderNumber", width: 20 },
  );
  items.columns = columns;
  for (const item of note.items) {
    items.addRow({
      sku: item.sku,
      subgroup: item.subgroup ?? "",
      collection: item.collection ?? "",
      shortDescription: item.shortDescription ?? "",
      shortName: item.shortName ?? item.name,
      attribute1: item.attribute1 ?? "",
      attribute2: item.attribute2 ?? "",
      attribute3: item.attribute3 ?? "",
      attribute4: item.attribute4 ?? "",
      color1: item.color1 ?? "",
      color2: item.color2 ?? "",
      ...(includePrices
        ? {
            unitPriceGross: Number(item.unitPriceGross),
            totalNet: Number(item.totalNet),
            totalVat: Number(item.totalVat),
            totalGross: Number(item.totalGross),
          }
        : {}),
      qty: item.qty,
      sourceOrderNumber: item.sourceOrderNumber ?? "",
    });
  }
  items.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: Math.max(items.rowCount, 1), column: items.columnCount },
  };
  items.getRow(1).eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF2F2924" },
    };
  });
  items.eachRow((row) => {
    row.alignment = { vertical: "top", wrapText: true };
  });
  if (includePrices) {
    for (const key of [
      "unitPriceGross",
      "totalNet",
      "totalVat",
      "totalGross",
    ]) {
      items.getColumn(key).numFmt = "#,##0.00";
    }
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return new Response(new Uint8Array(buffer), {
    headers: {
      "content-type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="otpremnica-${note.number.replaceAll("/", "-")}.xlsx"`,
      "cache-control": "private, no-store",
    },
  });
}
