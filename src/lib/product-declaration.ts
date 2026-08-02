import { richTextPlainText } from "@/lib/rich-text";

const DECLARATION_IMPORTER = "Svet povoljnih cena doo";
const GENERATED_LABELS = new Set([
  "vrsta robe",
  "naziv",
  "jedinica mere",
  "uvoznik",
  "materijal",
  "zemlja porekla",
]);

type ProductDeclarationInput = {
  name: string;
  shortName?: string | null;
  shortDescription?: string | null;
  materialText?: string | null;
  materialLabels?: string[];
  countryOfOrigin?: string | null;
  manualDeclaration?: string | null;
};

function clean(value: string | null | undefined) {
  return value?.replace(/\s+/g, " ").trim() ?? "";
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
  const kind =
    clean(input.shortDescription) ||
    manual.fields.get("vrsta robe") ||
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
    clean(input.countryOfOrigin) ||
    manual.fields.get("zemlja porekla") ||
    "";

  const lines = [
    `Vrsta robe: ${kind}`,
    `Naziv: ${designation}`,
    "Jedinica mere: komad",
    `Uvoznik: ${DECLARATION_IMPORTER}`,
    ...(material ? [`Materijal: ${material}`] : []),
    ...(countryOfOrigin ? [`Zemlja porekla: ${countryOfOrigin}`] : []),
  ];

  if (manual.supplemental.length) {
    lines.push("", ...manual.supplemental);
  }

  return lines.join("\n");
}
