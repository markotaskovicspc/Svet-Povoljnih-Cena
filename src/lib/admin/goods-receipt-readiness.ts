import { hasProductVolumeSource } from "@/lib/admin/purchase-order";

type GoodsReceiptProduct = {
  id: string;
  sku: string;
  name: string;
  description: string;
  supplierId: string | null;
  supplier?: { country: string | null } | null;
  countryOfOrigin: string | null;
  hsCode: string | null;
  widthCm: unknown;
  depthCm: unknown;
  heightCm: unknown;
  grossWeightKg: unknown;
  packQty: number | null;
  packWidthCm: unknown;
  packDepthCm: unknown;
  packHeightCm: unknown;
  packGrossWeightKg: unknown;
  containerQty: number | null;
  containerGrossWeightKg: unknown;
  categories: readonly unknown[];
  priceListEntries: readonly unknown[];
};

type GoodsReceiptLine = {
  qty: number;
  sku: string;
  product: GoodsReceiptProduct | null;
};

export type GoodsReceiptMasterWarning = {
  productId: string | null;
  sku: string;
  issues: string[];
};

export type GoodsReceiptCountryOriginFallback = {
  productId: string;
  sku: string;
  country: string;
  previousCountryOfOrigin: string | null;
};

function positive(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0;
}

export function goodsReceiptMasterIssues(product: GoodsReceiptProduct) {
  const issues: string[] = [];
  if (!product.name.trim()) issues.push("naziv");
  if (!product.description.trim()) issues.push("opis");
  if (!product.supplierId) issues.push("dobavljač");
  if (!product.categories.length) issues.push("kategorija");
  if (
    !product.countryOfOrigin?.trim() &&
    !product.supplier?.country?.trim()
  ) {
    issues.push("zemlja porekla");
  }
  if (!product.hsCode?.trim()) issues.push("tarifni broj");
  if (![product.widthCm, product.depthCm, product.heightCm].every(positive)) {
    issues.push("dimenzije artikla");
  }
  if (!positive(product.grossWeightKg)) issues.push("bruto težina artikla");
  if (!hasProductVolumeSource({
    containerQty: product.containerQty,
    containerGrossWeightKg: Number(product.containerGrossWeightKg),
    packQty: product.packQty,
    packWidthCm: Number(product.packWidthCm),
    packDepthCm: Number(product.packDepthCm),
    packHeightCm: Number(product.packHeightCm),
  })) {
    issues.push("količina kontejnera ili transportne dimenzije paketa");
  }
  if (!positive(product.containerQty)) {
    if (!product.packQty || product.packQty < 1) issues.push("broj komada u paketu");
    if (!positive(product.packGrossWeightKg)) issues.push("bruto težina paketa");
  }
  if (!product.priceListEntries.length) issues.push("aktivna maloprodajna cena");
  return issues;
}

export function goodsReceiptMasterWarnings(
  lines: readonly GoodsReceiptLine[],
): GoodsReceiptMasterWarning[] {
  const warnings: GoodsReceiptMasterWarning[] = [];
  for (const line of lines) {
    if (line.qty <= 0) continue;
    if (!line.product) {
      warnings.push({
        productId: null,
        sku: line.sku,
        issues: ["artikal nije povezan sa masterom"],
      });
      continue;
    }
    const issues = goodsReceiptMasterIssues(line.product);
    if (issues.length) {
      warnings.push({ productId: line.product.id, sku: line.sku, issues });
    }
  }
  return warnings;
}

export function goodsReceiptCountryOriginFallbacks(
  lines: readonly GoodsReceiptLine[],
): GoodsReceiptCountryOriginFallback[] {
  const fallbacks = new Map<string, GoodsReceiptCountryOriginFallback>();
  for (const line of lines) {
    const product = line.product;
    const country = product?.supplier?.country?.trim();
    if (
      line.qty <= 0 ||
      !product ||
      product.countryOfOrigin?.trim() ||
      !country
    ) {
      continue;
    }
    fallbacks.set(product.id, {
      productId: product.id,
      sku: line.sku,
      country,
      previousCountryOfOrigin: product.countryOfOrigin,
    });
  }
  return [...fallbacks.values()];
}
