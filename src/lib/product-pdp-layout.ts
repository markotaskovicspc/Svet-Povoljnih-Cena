import type { Product } from "@/types";

export function resolveProductPdpLayout(
  product: Pick<Product, "supplierIntegrationKey" | "technicalSpecs">,
) {
  const isRabalux = product.supplierIntegrationKey === "RABALUX";
  return {
    isRabalux,
    showStandaloneMaterials: !isRabalux,
    showStandaloneTechnicalAndDocuments: !isRabalux,
    descriptionTechnicalSpecs: isRabalux ? product.technicalSpecs : undefined,
  };
}
