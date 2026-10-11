import "server-only";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { Readable } from "node:stream";
import { statementRowSchema, type Carrier, type StatementRow } from "./finance";

export const STATEMENT_HEADERS = ["tip", "broj_posiljke", "porudzbina", "datum", "tezina_kg", "iznos_rsd", "pdv_ukljucen", "opis"];
const fold = (value: string) => value.replace(/^\uFEFF/, "").trim().toLowerCase();
function text(cell: ExcelJS.Cell) {
  if (cell.type === ExcelJS.ValueType.Formula) throw new Error("Formule nisu dozvoljene u specifikaciji.");
  return cell.text.trim();
}
export function decimal(value: string) {
  const cleaned = value.replace(/[\s\u00a0]/g, "");
  if (!cleaned || !/^[0-9.,]+$/.test(cleaned)) return NaN;
  return Number(cleaned.includes(",") ? cleaned.replace(/\./g, "").replace(",", ".") : cleaned);
}
function checked(row: unknown, number: number) {
  const result = statementRowSchema.safeParse(row);
  if (!result.success) throw new Error(`Red ${number}: ${result.error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`).join(" ")}`);
  return result.data;
}
export async function parseStatementFile(bytes: Buffer, filename: string, provider: Carrier, remittedOn: string): Promise<StatementRow[]> {
  if (!bytes.length || bytes.length > 2 * 1024 * 1024) throw new Error("Datoteka mora biti manja od 2 MB.");
  const workbook = new ExcelJS.Workbook();
  if (/\.xlsx$/i.test(filename)) {
    // GLS exports use x: element prefixes that ExcelJS does not understand.
    // Normalize only the spreadsheet namespace, without changing source values.
    const zip = await JSZip.loadAsync(bytes);
    let expanded = 0;
    for (const entry of Object.values(zip.files)) {
      if (!entry.name.endsWith(".xml")) continue;
      const xml = await entry.async("string");
      expanded += Buffer.byteLength(xml);
      if (expanded > 20 * 1024 * 1024) throw new Error("Raspakovana datoteka je prevelika.");
      if (xml.includes('xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"')) {
        zip.file(entry.name, xml.replace(/<(\/?)x:/g, "<$1").replace('xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"', 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'));
      }
    }
    await workbook.xlsx.load(await zip.generateAsync({ type: "nodebuffer" }) as never);
  } else if (/\.csv$/i.test(filename)) {
    const firstLine = bytes.toString("utf8").split(/\r?\n/)[0];
    await workbook.csv.read(Readable.from([bytes]), { parserOptions: { delimiter: firstLine.includes(";") ? ";" : ",", ignoreEmpty: true }, map: value => value });
  } else throw new Error("Koristite XLSX ili CSV. PDF/sliku prepišite u ponuđeni obrazac.");
  const sheet = workbook.worksheets[0];
  if (!sheet || sheet.rowCount > 2050 || sheet.columnCount > 50) throw new Error("Dozvoljeno je najviše 2000 stavki i 50 kolona.");
  let headerRow = 0;
  let headers: string[] = [];
  let gls = false;
  let glsCosts = false;
  for (let i = 1; i <= Math.min(30, sheet.rowCount); i++) {
    const row = sheet.getRow(i);
    const names = Array.from({ length: row.cellCount }, (_, index) => fold(text(row.getCell(index + 1))));
    if (names.some(name => name.endsWith("/ parcel number")) && names.some(name => name.endsWith("/ total amount"))) { headerRow = i; headers = names; glsCosts = true; break; }
    if (STATEMENT_HEADERS.every(header => names.includes(header))) { headerRow = i; headers = names; break; }
    if (names.includes("parcel number") && names.includes("cod amount") && names.includes("cod reference")) { headerRow = i; headers = names; gls = true; break; }
  }
  if (!headerRow) throw new Error("Kolone nisu prepoznate. Koristite obrazac ili originalnu GLS COD specifikaciju.");
  if ((gls || glsCosts) && provider !== "MYGLS") throw new Error("Ovo je GLS COD datoteka. Izaberite GLS.");
  const result: StatementRow[] = [];
  for (let i = headerRow + 1; i <= sheet.rowCount; i++) {
    const row = sheet.getRow(i);
    const get = (name: string) => text(row.getCell(headers.indexOf(name) + 1));
    if (glsCosts) {
      const bySuffix = (suffix: string) => get(headers.find(name => name.endsWith(suffix))!);
      const parcel = bySuffix("/ parcel number");
      if (!parcel) throw new Error(`Red ${i}: nedostaje broj paketa.`);
      if (bySuffix("/ currency") !== "RSD") throw new Error(`Red ${i}: podržana je samo valuta RSD.`);
      const amount = decimal(bySuffix("/ total amount"));
      // Fees in sheet 2 are a breakdown of this total, never additional charges.
      result.push(checked({ kind: "COST", trackingNo: parcel,
        orderNumber: (bySuffix("/ cod reference") || bySuffix("/ client reference")).replace(/-P\d+$/, "") || undefined,
        bookedOn: remittedOn, weightKg: decimal(bySuffix("/ weight / size")),
        amount, vatIncluded: false,
        description: `Transport ${bySuffix("/ transport fee")}; gorivo ${bySuffix("/ diesel fee")}; usluge ${bySuffix("/ total service fees")}; doplate ${bySuffix("/ total surcharges fee")}` }, i));
    } else if (gls) {
      const parcel = get("parcel number");
      if (!parcel) {
        // GLS has a total/footer after its item rows.
        if (row.cellCount && row.getCell(1).text.trim() && !/total|ukupno/i.test(row.getCell(1).text)) throw new Error(`Red ${i}: nedostaje broj paketa.`);
        continue;
      }
      const currency = headers.find(name => /currency/.test(name));
      if (currency && get(currency) !== "RSD") throw new Error(`Red ${i}: podržana je samo valuta RSD.`);
      result.push(checked({ kind: "COD", trackingNo: parcel, orderNumber: get("cod reference"), bookedOn: remittedOn, amount: decimal(get("cod amount")), vatIncluded: true }, i));
    } else {
      if (!headers.some(header => get(header))) continue;
      const kind = get("tip").toUpperCase();
      const vat = get("pdv_ukljucen").toLowerCase();
      if (!["da", "ne"].includes(vat)) throw new Error(`Red ${i}: pdv_ukljucen mora biti da ili ne.`);
      const dateCell = row.getCell(headers.indexOf("datum") + 1);
      result.push(checked({ kind: kind === "TROSAK" ? "COST" : kind === "POUZECE" ? "COD" : kind,
        trackingNo: get("broj_posiljke"), orderNumber: get("porudzbina") || undefined,
        bookedOn: dateCell.value instanceof Date ? dateCell.value.toISOString().slice(0, 10) : get("datum"),
        weightKg: get("tezina_kg") ? decimal(get("tezina_kg")) : undefined,
        amount: decimal(get("iznos_rsd")), vatIncluded: vat === "da", description: get("opis") || undefined }, i));
    }
    if (result.length > 2000) throw new Error("Dozvoljeno je najviše 2000 stavki.");
  }
  if (glsCosts && workbook.worksheets.slice(2).some(sheet => sheet.rowCount > 1)) throw new Error("Specifikacija ima bankarske/kartične naknade. Dodajte ih u standardni obrazac pre uvoza.");
  if (!result.length) throw new Error("Specifikacija nema stavke.");
  return result;
}
