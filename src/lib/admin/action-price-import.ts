export type ActionPriceImportRow = { row: number; sku: string; salePrice: number };
export const MAX_ACTION_IMPORT_ROWS = 500;
const key = (value: string) => value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z]/g, "");
export function parseActionPriceRows(records: string[][]): ActionPriceImportRow[] {
  const header = records[0]?.map(key) ?? [];
  const skuColumn = header.findIndex(h => ["sifra", "sku", "sifraartikla"].includes(h));
  const priceColumn = header.findIndex(h => ["akcijskacena", "akcijskampcena", "saleprice", "cena"].includes(h));
  if (skuColumn < 0 || priceColumn < 0) throw new Error("Prvi red mora sadržati kolone Šifra i Akcijska cena.");
  const rows: ActionPriceImportRow[] = [];
  const seen = new Set<string>();
  records.slice(1).forEach((cells, index) => {
    if (cells.every(cell => !cell.trim())) return;
    const row = index + 2;
    const sku = (cells[skuColumn] ?? "").trim();
    let price = (cells[priceColumn] ?? "").trim().replace(/[\s\u00a0]/g, "");
    if (/^(?:\d+|\d{1,3}(?:\.\d{3})+),\d{1,2}$/.test(price)) price = price.replace(/\./g, "").replace(",", ".");
    else if (/^\d{1,3}(\.\d{3})+$/.test(price)) price = price.replace(/\./g, "");
    if (!sku || sku.length > 100) throw new Error(`Red ${row}: nedostaje ispravna šifra.`);
    if (seen.has(sku.toLowerCase())) throw new Error(`Red ${row}: duplirana šifra ${sku}.`);
    if (!/^\d+(\.\d{1,2})?$/.test(price) || !Number.isFinite(Number(price)) || Number(price) <= 0) throw new Error(`Red ${row}: neispravna akcijska cena za ${sku}.`);
    seen.add(sku.toLowerCase()); rows.push({ row, sku, salePrice: Number(price) });
  });
  if (!rows.length || rows.length > MAX_ACTION_IMPORT_ROWS) throw new Error(`Uvoz mora sadržati od 1 do ${MAX_ACTION_IMPORT_ROWS} artikala.`);
  return rows;
}
export function parseActionPriceText(text: string) {
  const clean = text.replace(/^\uFEFF/, "");
  const first = clean.split(/\r?\n/, 1)[0];
  const separator = first.includes("\t") ? "\t" : first.includes(";") ? ";" : ",";
  const rows: string[][] = []; let row: string[] = []; let cell = ""; let quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (c === '"') {
      if (quoted && clean[i + 1] === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (!quoted && (c === separator || c === "\n" || c === "\r")) {
      row.push(cell); cell = "";
      if (c !== separator) { rows.push(row); row = []; if (c === "\r" && clean[i + 1] === "\n") i++; }
    } else cell += c;
  }
  if (quoted) throw new Error("Nezatvoreni navodnici u CSV datoteci.");
  if (cell || row.length) rows.push([...row, cell]);
  return parseActionPriceRows(rows);
}
