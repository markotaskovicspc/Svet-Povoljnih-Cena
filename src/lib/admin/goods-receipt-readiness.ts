type GoodsReceiptProduct = {
  sku: string;
  name: string;
  description: string;
  supplierId: string | null;
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
  categories: readonly unknown[];
  priceListEntries: readonly unknown[];
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
  if (!product.countryOfOrigin?.trim()) issues.push("zemlja porekla");
  if (!product.hsCode?.trim()) issues.push("tarifni broj");
  if (![product.widthCm, product.depthCm, product.heightCm].every(positive)) {
    issues.push("dimenzije artikla");
  }
  if (!positive(product.grossWeightKg)) issues.push("bruto težina artikla");
  if (!product.packQty || product.packQty < 1) issues.push("broj komada u paketu");
  if (
    ![product.packWidthCm, product.packDepthCm, product.packHeightCm].every(positive)
  ) {
    issues.push("transportne dimenzije paketa");
  }
  if (!positive(product.packGrossWeightKg)) issues.push("bruto težina paketa");
  if (!product.priceListEntries.length) issues.push("aktivna maloprodajna cena");
  return issues;
}
