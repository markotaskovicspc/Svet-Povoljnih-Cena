export type OpeningInventoryRow = {
  line: number;
  sku: string;
  qty: number;
  widthCm: number | null;
  depthCm: number | null;
  heightCm: number | null;
};

export type OpeningInventoryParseResult = {
  rows: OpeningInventoryRow[];
  errors: string[];
};

export type InventoryImportChangeSummary = {
  changed: number;
  unchanged: number;
  increasedUnits: number;
  decreasedUnits: number;
};

export type InventoryImportPreviewResult = InventoryImportChangeSummary & {
  file: string;
  rows: number;
  dimensionsRows: number;
  applied: boolean;
  previewToken?: string;
  samples: Array<{
    sku: string;
    current: number;
    target: number;
    delta: number;
  }>;
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
  return parseOpeningInventoryTable(
    lines.map((line) => parseCsvLine(line, delimiter)),
  );
}

export function parseOpeningInventoryTable(
  table: string[][],
): OpeningInventoryParseResult {
  if (table.length < 2) {
    return { rows: [], errors: ["Tabela mora imati zaglavlje i najmanje jedan red."] };
  }
  const headers = table[0]!.map(normalizeHeader);
  const indexes = Object.fromEntries(
    Object.entries(HEADER_ALIASES).map(([key, aliases]) => [
      key,
      headers.findIndex((header) => aliases.map(normalizeHeader).includes(header)),
    ]),
  ) as Record<keyof typeof HEADER_ALIASES, number>;
  const missing = (["sku", "qty"] as const).filter((key) => indexes[key] < 0);
  if (missing.length) {
    return {
      rows: [],
      errors: [`Nedostaju obavezne kolone: ${missing.join(", ")}.`],
    };
  }
  const dimensionIndexes = [indexes.widthCm, indexes.depthCm, indexes.heightCm];
  const hasAnyDimensionColumn = dimensionIndexes.some((index) => index >= 0);
  if (hasAnyDimensionColumn && dimensionIndexes.some((index) => index < 0)) {
    return {
      rows: [],
      errors: [
        "Dimenzije su opcione, ali ako se unose tabela mora imati widthCm, depthCm i heightCm.",
      ],
    };
  }

  const rows: OpeningInventoryRow[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  for (let i = 1; i < table.length; i += 1) {
    const lineNumber = i + 1;
    const cells = table[i]!;
    if (!cells.some((cell) => cell.trim())) continue;
    const sku = cells[indexes.sku]?.trim();
    const qty = parseLocaleNumber(cells[indexes.qty]);
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
    let widthCm: number | null = null;
    let depthCm: number | null = null;
    let heightCm: number | null = null;
    if (hasAnyDimensionColumn) {
      const rawDimensions = [
        cells[indexes.widthCm]?.trim() ?? "",
        cells[indexes.depthCm]?.trim() ?? "",
        cells[indexes.heightCm]?.trim() ?? "",
      ];
      const hasAnyDimensionValue = rawDimensions.some(Boolean);
      if (hasAnyDimensionValue) {
        const dimensions = rawDimensions.map(parseLocaleNumber);
        if (!dimensions.every((value) => Number.isFinite(value) && value > 0)) {
          errors.push(
            `Red ${lineNumber}: dimenzije za ${sku} moraju biti sve prazne ili sve veće od nule.`,
          );
          continue;
        }
        [widthCm, depthCm, heightCm] = dimensions;
      }
    }
    rows.push({ line: lineNumber, sku, qty, widthCm, depthCm, heightCm });
  }
  return { rows, errors };
}

export function summarizeInventoryImportChanges(
  rows: OpeningInventoryRow[],
  currentPhysicalBySku: ReadonlyMap<string, number>,
): InventoryImportChangeSummary {
  return rows.reduce<InventoryImportChangeSummary>(
    (summary, row) => {
      const current = currentPhysicalBySku.get(row.sku) ?? 0;
      const delta = row.qty - current;
      if (delta === 0) summary.unchanged += 1;
      else summary.changed += 1;
      if (delta > 0) summary.increasedUnits += delta;
      if (delta < 0) summary.decreasedUnits += Math.abs(delta);
      return summary;
    },
    { changed: 0, unchanged: 0, increasedUnits: 0, decreasedUnits: 0 },
  );
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
