import type { Product } from "@/types";
import { getCatalogReadiness } from "@/lib/catalog-readiness";
import {
  hasStorefrontIncomingStock,
  isRabaluxStorefrontProduct,
} from "@/lib/storefront-incoming";

type ProductAvailabilityInput = Pick<
  Product,
  | "stock"
  | "incomingStock"
  | "fullPrice"
  | "dimensionsCm"
  | "media"
  | "deliveryDays"
  | "packageDimensionsCm"
  | "supplierNextArrivalAt"
  | "availabilitySource"
  | "supplierIntegrationKey"
>;

export function getProductAvailability(product: ProductAvailabilityInput) {
  const stock = Number.isFinite(product.stock) ? product.stock : 0;
  const incomingStock = Number.isFinite(product.incomingStock)
    ? product.incomingStock
    : 0;
  const displayDimensions = product.dimensionsCm;
  const packageDimensions = product.packageDimensionsCm;
  const hasDisplayDimensions = Object.values(displayDimensions).every(
    (value) => Number.isFinite(value) && value > 0,
  );
  const readiness = getCatalogReadiness({
    ...product,
    dimensionsCm:
      hasDisplayDimensions || !packageDimensions
        ? displayDimensions
        : packageDimensions,
  });
  const isRabalux = isRabaluxStorefrontProduct(
    product.supplierIntegrationKey,
  );

  if (!readiness.ready) {
    return {
      canAddToCart: false,
      label: "Podaci se dopunjuju",
      addLabel: "Uskoro dostupno",
      message: "Proizvod još nije spreman za bezbednu online kupovinu",
      isSupplierSourced: false,
      readiness,
    };
  }

  if (stock > 0) {
    const supplierOnly = product.availabilitySource === "SUPPLIER";
    const mixed = product.availabilitySource === "MIXED";
    return {
      canAddToCart: true,
      label: supplierOnly
        ? isRabalux
          ? "Dostupno kod dobavljača"
          : "Dostupno"
        : "Na stanju",
      addLabel: "Dodaj u korpu",
      message: supplierOnly
        ? `${isRabalux ? "Dostupno kod dobavljača · " : ""}Isporuka ${product.deliveryDays.min}–${product.deliveryDays.max} radnih dana`
        : mixed
          ? "Spremno za poručivanje"
          : stock <= 2
            ? `Još ${stock} na stanju`
            : "Spremno za poručivanje",
      isSupplierSourced: supplierOnly || mixed,
      readiness,
    };
  }

  if (hasStorefrontIncomingStock({
    incomingStock,
    supplierIntegrationKey: product.supplierIntegrationKey,
  })) {
    return {
      canAddToCart: false,
      label: "U dolasku",
      addLabel: "U dolasku",
      message: "Trenutno nije dostupno za online kupovinu",
      isSupplierSourced: false,
      readiness,
    };
  }

  const nextArrival = product.supplierNextArrivalAt;
  if (!isRabalux && nextArrival) {
    const date = new Date(nextArrival);
    if (!Number.isNaN(date.getTime()) && date.getTime() > Date.now()) {
      return {
        canAddToCart: false,
        label: "U dolasku",
        addLabel: "U dolasku",
        message: `Sledeći očekivani dolazak: ${date.toLocaleDateString(
          "sr-Latn-RS",
        )}`,
        isSupplierSourced: false,
        readiness,
      };
    }
  }

  return {
    canAddToCart: false,
    label: "Nije dostupno",
    addLabel: "Nije dostupno",
    message: "Trenutno nije dostupno za online kupovinu",
    isSupplierSourced: false,
    readiness,
  };
}

export type ProductAvailability = ReturnType<typeof getProductAvailability>;
