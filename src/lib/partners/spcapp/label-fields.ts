import { buildProductDeclaration, declarationImporterForSku } from '@/lib/product-declaration';

type LabelSource = { sku: string; name: string; slug: string | null; barcode: string | null; countryOfOrigin: string | null; declaration: string | null };

/** Read-only box-label fields for SPC Analytics, derived exactly like the ERP's own product labels. */
export function analyticsLabelFields(p: LabelSource) {
  const declaration = buildProductDeclaration({ sku: p.sku, name: p.name, countryOfOrigin: p.countryOfOrigin, manualDeclaration: p.declaration });
  return {
    barcode: p.barcode?.trim() || null,
    countryOfOrigin: declaration.match(/^Zemlja porekla: (.+)$/m)?.[1] ?? null,
    importer: declarationImporterForSku(p.sku),
    productPath: p.slug ? `/p/${p.slug}` : null,
  };
}
