import type { Product } from "@/types";
import { ProductCard } from "@/components/product/product-card";

export function PurchaseSuggestion({ products }: { products: Product[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {products.map((product) => (
        <ProductCard key={product.sku} product={product} className="h-full" />
      ))}
    </div>
  );
}
