import { richTextPlainText } from "@/lib/rich-text";

const SPC_DECLARATION_IMPORTER = "Svet povoljnih cena doo";
const EVONEK_DECLARATION_IMPORTER = "Evonek doo";
const RABALUX_DECLARATION_IMPORTER = "Rabalux";
const GENERATED_LABELS = new Set([
  "vrsta robe",
  "naziv",
  "jedinica mere",
  "uvoznik",
  "materijal",
  "zemlja porekla",
]);

type ProductDeclarationInput = {
  sku?: string | null;
  name: string;
  shortName?: string | null;
  shortDescription?: string | null;
  categoryLabels?: string[];
  materialText?: string | null;
  materialLabels?: string[];
  countryOfOrigin?: string | null;
  manualDeclaration?: string | null;
};

export function declarationImporterForSku(sku: string | null | undefined) {
  const normalizedSku = clean(sku).toLocaleUpperCase("sr-Latn-RS");
  if (normalizedSku.startsWith("RAB")) return RABALUX_DECLARATION_IMPORTER;
  if (normalizedSku.startsWith("2")) return EVONEK_DECLARATION_IMPORTER;
  return SPC_DECLARATION_IMPORTER;
}

function clean(value: string | null | undefined) {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function conciseProductKind(value: string | null | undefined) {
  const normalized = clean(value);
  if (!normalized) return "";
  return normalized.length <= 120 && normalized.split(/\s+/).length <= 12
    ? normalized
    : "";
}

function localizedCountryName(value: string | null | undefined) {
  const normalized = clean(value);
  if (!/^[a-z]{2}$/i.test(normalized)) return normalized;

  try {
    return (
      new Intl.DisplayNames(["sr-Latn-RS", "sr-Latn"], {
        type: "region",
      }).of(normalized.toUpperCase()) ?? normalized
    );
  } catch {
    return normalized;
  }
}

function manualDeclarationParts(value: string | null | undefined) {
  const fields = new Map<string, string>();
  const supplemental: string[] = [];
  const plainText = value ? richTextPlainText(value) : "";

  for (const rawLine of plainText.split(/\r?\n/)) {
    const line = clean(rawLine);
    if (!line) continue;
    const match = line.match(/^([^:]+):\s*(.*)$/);
    const label = clean(match?.[1]).toLocaleLowerCase("sr-Latn");
    if (match && GENERATED_LABELS.has(label)) {
      fields.set(label, clean(match[2]));
    } else {
      supplemental.push(line);
    }
  }

  return { fields, supplemental };
}

/**
 * Builds the customer-facing declaration from canonical article data. Existing
 * free-form declaration text is retained only as a supplemental note, while
 * the regulated labels always use the current product fields.
 */
export function buildProductDeclaration(input: ProductDeclarationInput) {
  const manual = manualDeclarationParts(input.manualDeclaration);
  const deepestCategory = [...(input.categoryLabels ?? [])]
    .reverse()
    .map(conciseProductKind)
    .find(Boolean);
  const kind =
    conciseProductKind(input.shortDescription) ||
    manual.fields.get("vrsta robe") ||
    deepestCategory ||
    clean(input.shortName) ||
    clean(input.name);
  const shortName = clean(input.shortName);
  const designation = shortName
    ? shortName.toLocaleLowerCase("sr-Latn").startsWith(
        kind.toLocaleLowerCase("sr-Latn"),
      )
      ? shortName
      : `${kind} ${shortName}`.trim()
    : manual.fields.get("naziv") || clean(input.name) || kind;
  const material =
    clean(input.materialText) ||
    clean(input.materialLabels?.join(", ")) ||
    manual.fields.get("materijal") ||
    "";
  const countryOfOrigin =
    localizedCountryName(
      clean(input.countryOfOrigin) || manual.fields.get("zemlja porekla"),
    );

  const lines = [
    `Vrsta robe: ${kind}`,
    `Naziv: ${designation}`,
    "Jedinica mere: komad",
    `Uvoznik: ${declarationImporterForSku(input.sku)}`,
    ...(material ? [`Materijal: ${material}`] : []),
    ...(countryOfOrigin ? [`Zemlja porekla: ${countryOfOrigin}`] : []),
  ];

  if (manual.supplemental.length) {
    lines.push("", ...manual.supplemental);
  }

  return lines.join("\n");
}
