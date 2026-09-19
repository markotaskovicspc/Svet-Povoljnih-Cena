/** Shared browser/server parser. No email or name is sent anywhere during preview. */
export const CONTACT_IMPORT_MAX_ROWS = 100_000;
export const CONTACT_IMPORT_MAX_BYTES = 50 * 1024 * 1024;
export const CONTACT_IMPORT_BATCH_SIZE = 200;
export const contactImportFields = ["email", "firstName", "lastName", "fullName", "consent", "consentedAt", "source", "language"] as const;
export type ContactImportField = typeof contactImportFields[number];
export type ContactColumnMapping = Partial<Record<ContactImportField, number>>;
export type ImportContact = {
  email: string; firstName: string | null; lastName: string | null; language: string;
  source: string; consented: boolean; consentedAt: string | null; rowNumber: number;
  customFields: Record<string, string>;
};
export type ContactImportTable = { headers: string[]; rows: string[][] };
const aliases: Record<ContactImportField, string[]> = {
  email: ["email", "e_mail", "mail", "mejl", "email_adresa", "email_address", "e_mail_address"],
  firstName: ["first_name", "firstname", "ime"], lastName: ["last_name", "lastname", "prezime", "surname"],
  fullName: ["name", "full_name", "ime_i_prezime", "puno_ime"],
  consent: ["consent", "saglasnost", "opt_in", "newsletter_saglasnost"],
  consentedAt: ["consented_at", "consent_date", "datum_saglasnosti", "datum_prijave"],
  source: ["source", "izvor"], language: ["language", "jezik"],
};
const affirmative = new Set(["1", "true", "yes", "da", "granted", "active", "potvrdjeno", "potvrđeno"]);
export function normalizeImportEmail(value: string) {
  const email = value.trim().toLowerCase();
  return /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i.test(email) && email.length <= 254 ? email : null;
}
function headerKey(value: string) {
  return value.replace(/^\uFEFF/, "").trim().toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}
export function guessContactColumns(headers: string[]): ContactColumnMapping {
  return Object.fromEntries(contactImportFields.flatMap((field) => {
    const index = headers.findIndex((header) => aliases[field].includes(headerKey(header)));
    return index >= 0 ? [[field, index]] : [];
  }));
}
export function parseContactCsv(input: string): string[][] {
  const firstLine = input.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = [",", ";", "\t"].sort((a, b) => firstLine.split(b).length - firstLine.split(a).length)[0]!;
  const rows: string[][] = []; let row: string[] = []; let value = ""; let quoted = false;
  const finishRow = () => {
    row.push(value.trim()); value = "";
    if (row.some(Boolean)) rows.push(row);
    row = [];
    if (rows.length > CONTACT_IMPORT_MAX_ROWS + 1) throw new Error("Dozvoljeno je najviše 100.000 redova po uvozu.");
  };
  for (let index = 0; index < input.length; index++) {
    const char = input[index]!;
    if (char === '"') {
      if (quoted && input[index + 1] === '"') { value += '"'; index++; } else quoted = !quoted;
    } else if (char === delimiter && !quoted) { row.push(value.trim()); value = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) { if (char === "\r" && input[index + 1] === "\n") index++; finishRow(); }
    else value += char;
  }
  if (quoted) throw new Error("CSV ima nezatvorene navodnike. Proverite poslednji red.");
  finishRow(); return rows;
}
export function contactTableFromRows(rows: string[][]): ContactImportTable {
  if (!rows.length) throw new Error("Nema kontakata za proveru.");
  const mapped = guessContactColumns(rows[0]!);
  const hasHeader = Object.keys(mapped).length > 0 || !rows[0]!.some((cell) => normalizeImportEmail(cell));
  const width = rows.reduce((maximum, row) => Math.max(maximum, row.length), 0);
  if (width > 50) throw new Error("Dozvoljeno je najviše 50 kolona.");
  const rawHeaders = Array.from({ length: width }, (_, i) => hasHeader ? (rows[0]![i] ?? `Kolona ${i + 1}`) : normalizeImportEmail(rows[0]![i] ?? "") ? "email" : `Kolona ${i + 1}`);
  const seen = new Map<string, number>();
  const headers = rawHeaders.map((raw, index) => {
    const name = raw.trim().replace(/^\uFEFF/, "").slice(0, 70) || `Kolona ${index + 1}`;
    const n = (seen.get(name) ?? 0) + 1; seen.set(name, n); return n === 1 ? name : `${name} (${n})`;
  });
  const contacts = hasHeader ? rows.slice(1) : rows;
  if (contacts.length > CONTACT_IMPORT_MAX_ROWS) throw new Error("Dozvoljeno je najviše 100.000 kontakata po uvozu.");
  return { headers, rows: contacts };
}
export function parsePastedContacts(input: string): ContactImportTable {
  if (new TextEncoder().encode(input).length > CONTACT_IMPORT_MAX_BYTES) throw new Error("Tekst je veći od 50 MB.");
  const trimmed = input.trim();
  if (!trimmed) throw new Error("Nalepite email adrese ili tabelu sa kontaktima.");
  // A plain address list can use spaces, newlines, commas or semicolons.
  const tokens = trimmed.split(/[\s,;]+/).filter(Boolean);
  const firstLine = trimmed.split(/\r?\n/, 1)[0]!;
  const parsedRows = parseContactCsv(trimmed);
  const structuredRows = parsedRows.some((row) => row.length > 1 && row.some((cell) => normalizeImportEmail(cell)) && row.some((cell) => cell && !normalizeImportEmail(cell)));
  const plainList = tokens.every((token) => normalizeImportEmail(token)) || !structuredRows && !trimmed.includes('"') && !trimmed.includes("\t") &&
    !Object.keys(guessContactColumns(parseContactCsv(firstLine)[0] ?? [])).length &&
    tokens.some((token) => normalizeImportEmail(token));
  if (plainList) return { headers: ["email"], rows: tokens.length <= CONTACT_IMPORT_MAX_ROWS ? tokens.map((token) => [token]) : (() => { throw new Error("Dozvoljeno je najviše 100.000 kontakata po uvozu."); })() };
  return contactTableFromRows(parsedRows);
}
export function prepareContactImport(table: ContactImportTable, mapping: ContactColumnMapping, consent?: { confirmed: boolean; source: string }) {
  if (mapping.email == null || mapping.email < 0 || mapping.email >= table.headers.length) throw new Error("Izaberite kolonu sa email adresom.");
  if (consent?.confirmed && consent.source.trim().length < 5) throw new Error("Navedite izvor dokumentovane saglasnosti (najmanje 5 znakova).");
  const contacts: ImportContact[] = []; const seen = new Set<string>(); let invalidRows = 0; let duplicateRows = 0;
  const read = (row: string[], field: ContactImportField) => mapping[field] == null ? "" : (row[mapping[field]!] ?? "").trim();
  for (const [index, row] of table.rows.entries()) {
    if (row.length > 50) throw new Error(`Red ${index + 1} ima više od 50 kolona.`);
    const email = normalizeImportEmail(read(row, "email"));
    if (!email) { invalidRows++; continue; }
    if (seen.has(email)) { duplicateRows++; continue; } seen.add(email);
    const granted = mapping.consent != null ? affirmative.has(read(row, "consent").toLowerCase()) : Boolean(consent?.confirmed);
    const date = read(row, "consentedAt");
    if (date && (!Number.isFinite(new Date(date).getTime()) || new Date(date).getTime() > Date.now())) throw new Error(`Red ${index + 1}: datum saglasnosti nije ispravan.`);
    const customFields = Object.fromEntries(table.headers.flatMap((header, column) => {
      const value = row[column]?.trim();
      if (!value || column === mapping.email) return [];
      if (value.length > 4000) throw new Error(`Red ${index + 1}: vrednost kolone „${header}” je duža od 4.000 znakova.`);
      return [[header, value]];
    }));
    if (new TextEncoder().encode(JSON.stringify(customFields)).length > 8192) throw new Error(`Red ${index + 1}: dodatni podaci prelaze 8 KB.`);
    contacts.push({ email, firstName: (read(row, "firstName") || read(row, "fullName")).slice(0, 120) || null,
      lastName: read(row, "lastName").slice(0, 120) || null, language: read(row, "language").slice(0, 20) || "sr-Latn",
      source: (read(row, "source") || (granted ? consent?.source : "") || "admin-import").slice(0, 60),
      consented: granted, consentedAt: granted && date ? new Date(date).toISOString() : null, rowNumber: index + 1, customFields });
  }
  if (!contacts.length) throw new Error("Nije pronađena nijedna ispravna email adresa.");
  const explicitConsent = contacts.filter((contact) => contact.consented).length;
  return { contacts, totalRows: table.rows.length, uniqueValid: contacts.length, invalidRows, duplicateRows, explicitConsent, withoutConsent: contacts.length - explicitConsent };
}
