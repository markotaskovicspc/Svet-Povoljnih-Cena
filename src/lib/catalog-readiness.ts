export type CatalogReadinessReason =
  | "invalid_price"
  | "missing_dimensions"
  | "missing_media"
  | "invalid_delivery_window";

export type CatalogReadinessInput = {
  fullPrice: number;
  salePrice?: number | null;
  dimensionsCm: { w: number; d: number; h: number };
  media: { images: readonly unknown[] };
  deliveryDays: { min: number; max: number };
};

export function getCatalogReadiness(product: CatalogReadinessInput) {
  const reasons: CatalogReadinessReason[] = [];
  const price = product.salePrice ?? product.fullPrice;
  if (!Number.isFinite(price) || price <= 0) {
    reasons.push("invalid_price");
  }
  if (
    ![product.dimensionsCm.w, product.dimensionsCm.d, product.dimensionsCm.h].every(
      (value) => Number.isFinite(value) && value > 0,
    )
  ) {
    reasons.push("missing_dimensions");
  }
  if (!product.media.images.length) reasons.push("missing_media");
  if (
    !Number.isFinite(product.deliveryDays.min) ||
    !Number.isFinite(product.deliveryDays.max) ||
    product.deliveryDays.min < 0 ||
    product.deliveryDays.max < product.deliveryDays.min
  ) {
    reasons.push("invalid_delivery_window");
  }
  return { ready: reasons.length === 0, reasons } as const;
}

export const CATALOG_READINESS_LABEL: Record<CatalogReadinessReason, string> = {
  invalid_price: "Cena nije ispravna",
  missing_dimensions: "Nedostaju dimenzije",
  missing_media: "Nedostaje fotografija",
  invalid_delivery_window: "Rok isporuke nije ispravan",
};
