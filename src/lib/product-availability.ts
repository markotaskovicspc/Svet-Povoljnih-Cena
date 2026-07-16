import type { Product } from "@/types";
import { getCatalogReadiness } from "@/lib/catalog-readiness";

type ProductAvailabilityInput = Pick<
  Product,
  | "stock"
  | "incomingStock"
  | "fullPrice"
  | "dimensionsCm"
  | "media"
  | "deliveryDays"
>;

export function getProductAvailability(product: ProductAvailabilityInput) {
  const stock = Number.isFinite(product.stock) ? product.stock : 0;
  const incomingStock = Number.isFinite(product.incomingStock)
    ? product.incomingStock
    : 0;
  const readiness = getCatalogReadiness(product);

  if (!readiness.ready) {
    return {
      canAddToCart: false,
      label: "Podaci se dopunjuju",
      addLabel: "Uskoro dostupno",
      message: "Proizvod još nije spreman za bezbednu online kupovinu",
      readiness,
    };
  }

  if (stock > 0) {
    return {
      canAddToCart: true,
      label: "Na stanju",
      addLabel: "Dodaj u korpu",
      message: stock <= 2 ? `Još ${stock} na stanju` : "Spremno za poručivanje",
      readiness,
    };
  }

  if (incomingStock > 0) {
    return {
      canAddToCart: false,
      label: "U dolasku",
      addLabel: "U dolasku",
      message: "Trenutno nije dostupno za online kupovinu",
      readiness,
    };
  }

  return {
    canAddToCart: false,
    label: "Nije dostupno",
    addLabel: "Nije dostupno",
    message: "Trenutno nije dostupno za online kupovinu",
    readiness,
  };
}
