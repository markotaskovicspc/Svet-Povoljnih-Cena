export type FeedAvailability = "in stock" | "out of stock" | "preorder";

export function resolveFeedAvailability(input: {
  aggregateStock: number;
  dcAvailableQty: number;
  incomingStock: number;
  supplierIntegrationKey?: string | null;
}): FeedAvailability {
  // Preserve the supplier-specific feed behavior. For ordinary products,
  // only audited DC stock is sellable on the web; other warehouses are not.
  const sellableStock =
    input.supplierIntegrationKey?.trim().toUpperCase() === "RABALUX"
      ? input.aggregateStock
      : input.dcAvailableQty;

  if (sellableStock > 0) return "in stock";
  if (input.incomingStock > 0) return "preorder";
  return "out of stock";
}
