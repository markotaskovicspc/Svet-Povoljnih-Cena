type StorefrontIncomingInput = {
  incomingStock?: number | null;
  supplierIntegrationKey?: string | null;
};

export function isRabaluxStorefrontProduct(
  supplierIntegrationKey: string | null | undefined,
) {
  return supplierIntegrationKey?.trim().toUpperCase() === "RABALUX";
}

/** Rabalux supplier arrivals are never presented as customer preorders. */
export function hasStorefrontIncomingStock(product: StorefrontIncomingInput) {
  return (
    !isRabaluxStorefrontProduct(product.supplierIntegrationKey) &&
    Number.isFinite(product.incomingStock) &&
    Number(product.incomingStock) > 0
  );
}
