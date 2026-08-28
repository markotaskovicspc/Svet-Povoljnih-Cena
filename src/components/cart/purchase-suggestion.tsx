import type { Product } from "@/types";
import { PurchaseSuggestionCard } from "./purchase-suggestion-card";

export function PurchaseSuggestion({ products }: { products: Product[] }) {
  return (
    <div
      data-testid="purchase-suggestion-grid"
      className="grid grid-cols-1 items-stretch gap-3 min-[360px]:grid-cols-2 md:grid-cols-3"
    >
      {products.map((product) => (
        <PurchaseSuggestionCard key={product.sku} product={product} />
      ))}
    </div>
  );
}
