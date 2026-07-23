import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { requireAdminAction } from "@/lib/admin";
import { db } from "@/lib/db";

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
  const order = await db.purchaseOrder.findUnique({
    where: { id },
    include: {
      supplier: true,
      loadingLocation: true,
      receivingWarehouse: true,
      transportDefinition: true,
      items: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!order) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Svet povoljnih cena ERP";
  workbook.created = new Date();
  const header = workbook.addWorksheet("Porudžbenica");
  const headerRows: Array<[string, string | number]> = [
    ["Broj porudžbenice", order.number],
    ["Status", order.status],
    ["Dobavljač", order.supplier?.name ?? ""],
    ["Uslovi plaćanja", order.supplier?.paymentTerms ?? ""],
    ["Mesto utovara", order.loadingLocation?.name ?? ""],
    ["Magacin za prijem", order.receivingWarehouse?.name ?? ""],
    ["Datum kreiranja", dateOnly(order.createdAt)],
    ["Datum porudžbine", dateOnly(order.orderDate)],
    ["Datum utovara", dateOnly(order.loadingDate)],
    ["Datum isporuke", dateOnly(order.deliveryDate)],
    ["Ukupna zapremina m3", Number(order.totalVolume ?? 0)],
    ["Ukupna težina kg", Number(order.totalWeight ?? 0)],
    ["Ukupna cena", Number(order.totalPrice)],
    ["Valuta", order.currency],
    ["Kurs", Number(order.exchangeRate)],
    ["Kalkulativna cena prevoza", Number(order.freightCost)],
    ["Valuta prevoza", order.freightCurrency],
    ["Kurs valute prevoza", Number(order.freightExchangeRate)],
    ["Tip transporta", order.transportDefinition?.name ?? order.transportType ?? ""],
    ["Paritet", order.parity ?? ""],
    ["Ukupna BM%", Number(order.bmPct ?? 0)],
    ["Napomena", order.notes ?? ""],
  ];
  header.addRows(headerRows);
  header.getColumn(1).width = 30;
  header.getColumn(2).width = 50;
  header.getColumn(1).font = { bold: true };

  const items = workbook.addWorksheet("Artikli", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  items.columns = [
    { header: "Šifra artikla", key: "sku", width: 18 },
    { header: "Naziv artikla", key: "name", width: 35 },
    { header: "Atributi artikla", key: "attributes", width: 28 },
    { header: "Dezen artikla", key: "pattern", width: 22 },
    { header: "Nabavna cena", key: "purchasePrice", width: 16 },
    { header: "Valuta", key: "currency", width: 10 },
    { header: "Paritet", key: "parity", width: 12 },
    { header: "Važenje cene od", key: "priceValidFrom", width: 18 },
    { header: "MOQ", key: "moq", width: 10 },
    { header: "Broj artikala u pakovanju", key: "packQty", width: 24 },
    { header: "Količina za poručivanje", key: "qty", width: 22 },
    { header: "Ukupna zapremina m3", key: "totalVolume", width: 22 },
    { header: "Ukupna težina kg", key: "totalWeight", width: 20 },
    { header: "Carinska stopa %", key: "customsRate", width: 18 },
    { header: "Kalkulativna MPC", key: "calcRetailPrice", width: 18 },
    { header: "BM%", key: "bmPct", width: 12 },
    { header: "Dobavljačev naziv artikla", key: "supplierProductName", width: 30 },
    { header: "Sertifikati", key: "certificates", width: 24 },
    { header: "Bar kod", key: "barcode", width: 18 },
  ];
  for (const item of order.items) {
    items.addRow({
      sku: item.sku,
      name: item.name,
      attributes: item.attributes ?? "",
      pattern: item.pattern ?? "",
      purchasePrice: Number(item.purchasePrice),
      currency: item.currency,
      parity: item.parity ?? "",
      priceValidFrom: dateOnly(item.priceValidFrom),
      moq: item.moq ?? "",
      packQty: item.packQty ?? "",
      qty: item.qty,
      totalVolume: Number(item.totalVolume ?? 0),
      totalWeight: Number(item.totalWeight ?? 0),
      customsRate: Number(item.customsRate ?? 0),
      calcRetailPrice: Number(item.calcRetailPrice ?? 0),
      bmPct: Number(item.bmPct ?? 0),
      supplierProductName: item.supplierProductName ?? "",
      certificates: item.certificates ?? "",
      barcode: item.barcode ?? "",
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
  for (const key of [
    "purchasePrice",
    "totalVolume",
    "totalWeight",
    "customsRate",
    "calcRetailPrice",
    "bmPct",
  ]) {
    items.getColumn(key).numFmt = "#,##0.00";
  }

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
