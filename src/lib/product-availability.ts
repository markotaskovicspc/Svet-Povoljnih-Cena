import type { Product } from "@/types";

type ProductAvailabilityInput = Pick<Product, "stock" | "incomingStock">;

export function getProductAvailability(product: ProductAvailabilityInput) {
  const stock = Number.isFinite(product.stock) ? product.stock : 0;
  const incomingStock = Number.isFinite(product.incomingStock)
    ? product.incomingStock
    : 0;

  if (stock > 0) {
    return {
      canAddToCart: true,
      label: "Na stanju",
      addLabel: "Dodaj u korpu",
      message: stock <= 2 ? `Još ${stock} na stanju` : "Spremno za poručivanje",
    };
  }

  if (incomingStock > 0) {
    return {
      canAddToCart: false,
      label: "U dolasku",
      addLabel: "U dolasku",
      message: "Trenutno nije dostupno za online kupovinu",
    };
  }

  return {
    canAddToCart: false,
    label: "Nije dostupno",
    addLabel: "Nije dostupno",
    message: "Trenutno nije dostupno za online kupovinu",
  };
}
