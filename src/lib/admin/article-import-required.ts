import { hasMeaningfulProductDescription } from "@/lib/product-descriptions";

export type NewArticleImportRequiredInput = {
  description: string | null;
  supplier: string | null;
  category: string | null;
  countryOfOrigin: string | null;
  hsCode: string | null;
  widthCm: number | null;
  depthCm: number | null;
  heightCm: number | null;
  grossWeightKg: number | null;
  packQty: number | null;
  packWidthCm: number | null;
  packDepthCm: number | null;
  packHeightCm: number | null;
  packGrossWeightKg: number | null;
  retailPrice: number | null;
};

export type NewArticleImportRequiredIssue = {
  field: keyof NewArticleImportRequiredInput;
  message: string;
};

function positive(value: number | null) {
  return value !== null && Number.isFinite(value) && value > 0;
}

export function validateNewArticleImportRequiredFields(
  input: NewArticleImportRequiredInput,
): NewArticleImportRequiredIssue[] {
  const issues: NewArticleImportRequiredIssue[] = [];
  if (!hasMeaningfulProductDescription(input.description)) {
    issues.push({ field: "description", message: "Opis za sajt je obavezan za novi artikal." });
  }
  if (!input.supplier?.trim()) {
    issues.push({ field: "supplier", message: "Dobavljač je obavezan za novi artikal." });
  }
  if (!input.category?.trim()) {
    issues.push({ field: "category", message: "Kategorija je obavezna za novi artikal." });
  }
  if (!input.countryOfOrigin?.trim()) {
    issues.push({
      field: "countryOfOrigin",
      message: "Zemlja porekla je obavezna za novi artikal.",
    });
  }
  if (!input.hsCode?.trim()) {
    issues.push({ field: "hsCode", message: "Tarifni broj je obavezan za novi artikal." });
  }
  if (![input.widthCm, input.depthCm, input.heightCm].every(positive)) {
    issues.push({
      field: "widthCm",
      message: "Sve dimenzije artikla moraju biti veće od nule.",
    });
  }
  if (!positive(input.grossWeightKg)) {
    issues.push({
      field: "grossWeightKg",
      message: "Bruto težina artikla mora biti veća od nule.",
    });
  }
  if (input.packQty === null || !Number.isInteger(input.packQty) || input.packQty < 1) {
    issues.push({
      field: "packQty",
      message: "Broj komada u transportnom paketu mora biti najmanje 1.",
    });
  }
  if (![input.packWidthCm, input.packDepthCm, input.packHeightCm].every(positive)) {
    issues.push({
      field: "packWidthCm",
      message: "Sve transportne dimenzije paketa moraju biti veće od nule.",
    });
  }
  if (!positive(input.packGrossWeightKg)) {
    issues.push({
      field: "packGrossWeightKg",
      message: "Bruto težina transportnog paketa mora biti veća od nule.",
    });
  }
  if (!positive(input.retailPrice)) {
    issues.push({
      field: "retailPrice",
      message: "Aktivna maloprodajna cena mora biti veća od nule.",
    });
  }
  return issues;
}
