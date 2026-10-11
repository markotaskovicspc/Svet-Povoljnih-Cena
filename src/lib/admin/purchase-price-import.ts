import { normalizePurchasePriceSku, parsePurchasePriceDate, parsePurchasePriceValue, validatePurchasePricePeriod } from "./purchase-price";

export const MAX_PURCHASE_PRICE_IMPORT_ROWS = 500;
export const MAX_PURCHASE_PRICE_IMPORT_BYTES = 2 * 1024 * 1024;
export const PURCHASE_PRICE_IMPORT_HEADERS = ["Šifra", "Nabavna cena", "Važenje od", "Važenje do", "Valuta", "Dobavljač"];
export type PurchasePriceImportRow = {
  row: number; sku: string; purchasePrice: string; validFrom: string; validTo: string;
  currency: string; supplier: string; errors: string[];
};

const headerKey = (value: string) => value.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z]/g, "");

// Decimal commas and Serbian thousands separators are accepted. Ambiguous US
// thousands notation is deliberately rejected instead of silently changing value.
export function normalizeImportedPurchasePrice(value: string) {
  let price = value.trim();
  if (/^\d{1,3}(?:[ \u00a0]\d{3})+(?:[,.]\d{1,2})?$/.test(price)) price = price.replace(/[ \u00a0]/g, "");
  if (/^\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/.test(price)) price = price.replace(/\./g, "");
  return parsePurchasePriceValue(price);
}

function importedDate(value: string, label: string) {
  const raw = value.trim();
  const local = raw.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})\.?$/);
  const iso = local ? `${local[3]}-${local[2].padStart(2, "0")}-${local[1].padStart(2, "0")}` : raw;
  return parsePurchasePriceDate(iso, label).toISOString().slice(0, 10);
}

export function parsePurchasePriceImportRows(records: string[][]): PurchasePriceImportRow[] {
  const aliases = [
    ["sifra", "sku", "sifraartikla"], ["nabavnacena", "purchaseprice", "cena"],
    ["vazenjeod", "vazenjeceneod", "validfrom", "datumod"],
    ["vazenjedo", "vazenjecenedo", "validto", "datumdo"],
    ["valuta", "currency"], ["dobavljac", "supplier", "sifradobavljaca"],
  ];
  const headers = records[0]?.map(headerKey) ?? [];
  const columns = aliases.map(names => {
    const matching = headers.flatMap((name, index) => names.includes(name) ? [index] : []);
    if (matching.length > 1) throw new Error("Zaglavlje sadrži duplirane kolone.");
    return matching[0] ?? -1;
  });
  if (columns.slice(0, 3).some(index => index < 0)) throw new Error("Obavezne kolone: Šifra, Nabavna cena i Važenje od.");
  const data = records.slice(1).map((cells, index) => ({ cells, row: index + 2 })).filter(({ cells }) => cells.some(cell => cell.trim()));
  if (!data.length || data.length > MAX_PURCHASE_PRICE_IMPORT_ROWS) throw new Error(`Datoteka mora sadržati od 1 do ${MAX_PURCHASE_PRICE_IMPORT_ROWS} redova.`);
  const rows = data.map(({ cells, row }) => {
    const [sku, purchasePrice, validFrom, validTo, currency, supplier] = columns.map(index => (cells[index] ?? "").trim());
    const result: PurchasePriceImportRow = { row, sku, purchasePrice, validFrom, validTo, currency: currency.toUpperCase(), supplier, errors: [] };
    const check = (fn: () => void) => { try { fn(); } catch (error) { result.errors.push(error instanceof Error ? error.message : "Neispravan podatak."); } };
    check(() => { result.sku = normalizePurchasePriceSku(sku); });
    check(() => { result.purchasePrice = normalizeImportedPurchasePrice(purchasePrice); });
    check(() => { result.validFrom = importedDate(validFrom, "Važenje od"); });
    if (validTo) check(() => { result.validTo = importedDate(validTo, "Važenje do"); });
    if (!result.errors.length) check(() => validatePurchasePricePeriod(new Date(result.validFrom), result.validTo ? new Date(result.validTo) : null));
    if (currency && !["RSD", "EUR", "USD"].includes(result.currency)) result.errors.push("Valuta mora biti RSD, EUR ili USD.");
    if (supplier.length > 200) result.errors.push("Dobavljač je predugačak.");
    return result;
  });
  const duplicates = new Map<string, PurchasePriceImportRow[]>();
  for (const row of rows) {
    const key = `${row.sku.toLowerCase()}:${row.validFrom}`;
    duplicates.set(key, [...(duplicates.get(key) ?? []), row]);
  }
  for (const group of duplicates.values()) if (group.length > 1) for (const row of group) row.errors.push("Duplirana šifra i datum važenja u datoteci.");
  return rows;
}

export function parsePurchasePriceCsv(text: string) {
  const clean = text.replace(/^\uFEFF/, "");
  const header = clean.split(/\r?\n/, 1)[0];
  const separator = header.includes("\t") ? "\t" : header.includes(";") ? ";" : ",";
  const records: string[][] = []; let row: string[] = []; let value = ""; let quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const char = clean[i];
    if (char === '"') {
      if (quoted && clean[i + 1] === '"') { value += '"'; i++; }
      else if (!quoted && value) throw new Error("Neispravni navodnici u CSV datoteci.");
      else quoted = !quoted;
    } else if (!quoted && (char === separator || char === "\r" || char === "\n")) {
      row.push(value); value = "";
      if (char !== separator) { records.push(row); row = []; if (char === "\r" && clean[i + 1] === "\n") i++; }
    } else value += char;
    if (records.length > MAX_PURCHASE_PRICE_IMPORT_ROWS + 1) throw new Error(`Najviše ${MAX_PURCHASE_PRICE_IMPORT_ROWS} redova po uvozu.`);
  }
  if (quoted) throw new Error("Nezatvoreni navodnici u CSV datoteci.");
  if (value || row.length) records.push([...row, value]);
  return parsePurchasePriceImportRows(records);
}
