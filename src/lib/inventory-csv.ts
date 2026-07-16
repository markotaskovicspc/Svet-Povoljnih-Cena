export type OpeningInventoryRow = {
  line: number;
  sku: string;
  qty: number;
  widthCm: number;
  depthCm: number;
  heightCm: number;
};

export type OpeningInventoryParseResult = {
  rows: OpeningInventoryRow[];
  errors: string[];
};

const HEADER_ALIASES = {
  sku: ["sku", "sifra", "šifra"],
  qty: ["qty", "kolicina", "količina", "stock", "lager", "stanje"],
  widthCm: ["widthcm", "width", "sirina", "širina"],
  depthCm: ["depthcm", "depth", "dubina"],
  heightCm: ["heightcm", "height", "visina", "visina cm"],
} as const;

export function parseOpeningInventoryCsv(text: string): OpeningInventoryParseResult {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) {
    return { rows: [], errors: ["CSV mora imati zaglavlje i najmanje jedan red."] };
  }
  const delimiter = detectDelimiter(lines[0]!);
  const headers = parseCsvLine(lines[0]!, delimiter).map(normalizeHeader);
  const indexes = Object.fromEntries(
    Object.entries(HEADER_ALIASES).map(([key, aliases]) => [
      key,
      headers.findIndex((header) => aliases.map(normalizeHeader).includes(header)),
    ]),
  ) as Record<keyof typeof HEADER_ALIASES, number>;
  const missing = Object.entries(indexes)
    .filter(([, index]) => index < 0)
    .map(([key]) => key);
  if (missing.length) {
    return {
      rows: [],
      errors: [`Nedostaju obavezne kolone: ${missing.join(", ")}.`],
    };
  }

  const rows: OpeningInventoryRow[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  for (let i = 1; i < lines.length; i += 1) {
    const lineNumber = i + 1;
    const cells = parseCsvLine(lines[i]!, delimiter);
    const sku = cells[indexes.sku]?.trim();
    const qty = parseLocaleNumber(cells[indexes.qty]);
    const widthCm = parseLocaleNumber(cells[indexes.widthCm]);
    const depthCm = parseLocaleNumber(cells[indexes.depthCm]);
    const heightCm = parseLocaleNumber(cells[indexes.heightCm]);
    if (!sku) {
      errors.push(`Red ${lineNumber}: SKU je obavezan.`);
      continue;
    }
    if (seen.has(sku)) {
      errors.push(`Red ${lineNumber}: SKU ${sku} se ponavlja.`);
      continue;
    }
    seen.add(sku);
    if (!Number.isInteger(qty) || qty < 0) {
      errors.push(`Red ${lineNumber}: količina za ${sku} mora biti nenegativan ceo broj.`);
      continue;
    }
    if (![widthCm, depthCm, heightCm].every((value) => value > 0)) {
      errors.push(`Red ${lineNumber}: sve tri dimenzije za ${sku} moraju biti veće od nule.`);
      continue;
    }
    rows.push({ line: lineNumber, sku, qty, widthCm, depthCm, heightCm });
  }
  return { rows, errors };
}

function detectDelimiter(header: string) {
  const candidates = [";", "\t", ","] as const;
  return candidates
    .map((delimiter) => ({ delimiter, count: parseCsvLine(header, delimiter).length }))
    .sort((a, b) => b.count - a.count)[0]!.delimiter;
}

function parseCsvLine(line: string, delimiter: string) {
  const cells: string[] = [];
  let value = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]!;
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        value += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === delimiter && !quoted) {
      cells.push(value);
      value = "";
    } else {
      value += char;
    }
  }
  cells.push(value);
  return cells;
}

function normalizeHeader(value: string) {
  return value
    .trim()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function parseLocaleNumber(value: string | undefined) {
  if (!value?.trim()) return Number.NaN;
  const normalized = value.trim().replace(/\s/g, "").replace(",", ".");
  return Number(normalized);
}
