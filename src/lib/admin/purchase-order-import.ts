export const MAX_PURCHASE_ORDER_IMPORT_ROWS = 500;
export const MAX_PURCHASE_ORDER_IMPORT_QTY = 1_000_000;
export type PurchaseOrderImportRow = { row: number; sku: string; qty: number };
const headerKey = (value: string) => value.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[\s_-]/g, "");

export function parsePurchaseOrderImportRows(records: string[][]): PurchaseOrderImportRow[] {
  const header = records[0]?.map(headerKey) ?? [];
  const skuColumns = header.flatMap((h, i) => ["sku", "sifra", "sifraartikla", "шифра", "шифраартикла"].includes(h) ? [i] : []);
  const qtyColumns = header.flatMap((h, i) => ["qty", "quantity", "kolicina", "количина"].includes(h) ? [i] : []);
  if (skuColumns.length !== 1 || qtyColumns.length !== 1) throw new Error("Prvi red mora sadržati po jednu kolonu Šifra i Količina.");
  const seen = new Set<string>();
  const rows: PurchaseOrderImportRow[] = [];
  records.slice(1).forEach((cells, index) => {
    if (cells.every(cell => !cell.trim())) return;
    const row = index + 2;
    const sku = (cells[skuColumns[0]] ?? "").trim();
    const rawQty = (cells[qtyColumns[0]] ?? "").trim();
    if (!sku || sku.length > 100) throw new Error(`Red ${row}: unesite ispravnu šifru (do 100 znakova).`);
    if (seen.has(sku.toLowerCase())) throw new Error(`Red ${row}: duplirana šifra ${sku}. Spojite količine u jedan red.`);
    if (!/^\d+$/.test(rawQty) || Number(rawQty) < 1 || Number(rawQty) > MAX_PURCHASE_ORDER_IMPORT_QTY) throw new Error(`Red ${row}: količina za ${sku} mora biti ceo broj od 1 do ${MAX_PURCHASE_ORDER_IMPORT_QTY}.`);
    seen.add(sku.toLowerCase());
    rows.push({ row, sku, qty: Number(rawQty) });
  });
  if (!rows.length || rows.length > MAX_PURCHASE_ORDER_IMPORT_ROWS) throw new Error(`Uvoz mora sadržati od 1 do ${MAX_PURCHASE_ORDER_IMPORT_ROWS} artikala.`);
  return rows;
}

export function parsePurchaseOrderImportCsv(text: string) {
  const clean = text.replace(/^\uFEFF/, "");
  const first = clean.split(/\r?\n/, 1)[0];
  const separator = first.includes("\t") ? "\t" : first.includes(";") ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const char = clean[i];
    if (char === '"') {
      if (quoted && clean[i + 1] === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (!quoted && [separator, "\n", "\r"].includes(char)) {
      row.push(cell); cell = "";
      if (char !== separator) { rows.push(row); row = []; if (char === "\r" && clean[i + 1] === "\n") i++; }
    } else cell += char;
  }
  if (quoted) throw new Error("Nezatvoreni navodnici u CSV datoteci.");
  if (cell || row.length) rows.push([...row, cell]);
  return parsePurchaseOrderImportRows(rows);
}
