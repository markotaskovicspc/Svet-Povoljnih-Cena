import "server-only";
import ExcelJS from "exceljs";
import { createHash } from "node:crypto";
import { nthPhoneNumber } from "@/lib/viber/nth";
import { parseContactCsv } from "@/lib/newsletter/import-parser";

const key = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
const phoneHeaders = new Set(["telefon", "brojtelefona", "phone", "phonenumber", "mobile", "mobilni", "mobilnitelefon", "msisdn", "broj", "tel"]);
const nameHeaders = new Set(["ime", "name", "imeiprezime", "fullname", "firstname"]);
export type PhoneImport = Awaited<ReturnType<typeof parsePhoneImport>>;
export function importPhone(value: string) {
  const s = value.trim();
  // Excel numeric cells lose the initial zero in local Serbian mobile numbers.
  return nthPhoneNumber(/^6\d{7,8}$/.test(s) ? `0${s}` : s);
}
function cellText(value: ExcelJS.CellValue): string {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (typeof value === "object" && "richText" in value) return value.richText.map(p => p.text).join("");
  if (typeof value === "object" && "text" in value) return String(value.text);
  // Do not use cached formula results as phone numbers.
  return "";
}
export async function parsePhoneImport(file: File, column?: number) {
  if (!file.size || file.size > 4 * 1024 * 1024) throw new Error("Izaberite XLSX ili CSV do 4 MB.");
  const bytes = await file.arrayBuffer();
  let rows: { number: number; cells: string[] }[] = [];
  if (/\.xlsx$/i.test(file.name)) {
    const workbook = new ExcelJS.Workbook();
    try { await workbook.xlsx.load(bytes); } catch { throw new Error("Excel fajl nije ispravan. Sačuvajte ga kao .xlsx."); }
    const sheet = workbook.worksheets[0];
    if (sheet) sheet.eachRow({ includeEmpty: false }, row => {
      rows.push({ number: row.number, cells: Array.from({ length: row.cellCount }, (_, i) => cellText(row.getCell(i + 1).value)) });
    });
  } else if (/\.csv$/i.test(file.name)) {
    rows = parseContactCsv(new TextDecoder().decode(bytes)).map((cells, i) => ({ cells, number: i + 1 }));
  } else throw new Error("Podržani su .xlsx i .csv. Stari .xls sačuvajte kao .xlsx.");
  if (!rows.length) throw new Error("Tabela je prazna.");
  const headerIndex = rows.slice(0, 20).findIndex(r => r.cells.some(v => phoneHeaders.has(key(v))));
  const header = headerIndex >= 0 ? rows[headerIndex].cells : [];
  const data = headerIndex >= 0 ? rows.slice(headerIndex + 1) : rows;
  const width = Math.max(...rows.slice(0, 20).map(r => r.cells.length));
  const columns = Array.from({ length: width }, (_, i) => ({ index: i, label: (header[i]?.trim() || `Kolona ${i + 1}`).slice(0, 80) }));
  const guessed = header.findIndex(v => phoneHeaders.has(key(v)));
  const phoneColumn = column ?? (guessed >= 0 ? guessed : columns.find(c => data.slice(0, 20).some(r => { try { importPhone(r.cells[c.index] ?? ""); return true; } catch { return false; } }))?.index ?? 0);
  if (!Number.isInteger(phoneColumn) || phoneColumn < 0 || phoneColumn >= width) throw new Error("Izaberite kolonu sa brojevima telefona.");
  const nameColumn = header.findIndex(v => nameHeaders.has(key(v)));
  const contacts = new Map<string, { phone: string; name: string }>();
  let duplicates = 0;
  const invalidRows: number[] = [];
  for (const row of data) {
    try {
      const phone = importPhone(row.cells[phoneColumn] ?? "");
      if (contacts.has(phone)) duplicates++;
      else contacts.set(phone, { phone, name: nameColumn >= 0 ? (row.cells[nameColumn] ?? "").trim().slice(0, 120) : "" });
    } catch { invalidRows.push(row.number); }
  }
  const digest = createHash("sha256").update(Buffer.from(bytes)).update(`:${phoneColumn}`).digest("hex");
  return { contacts: [...contacts.values()], totalRows: data.length, duplicates, invalidRows, columns, phoneColumn, digest };
}
