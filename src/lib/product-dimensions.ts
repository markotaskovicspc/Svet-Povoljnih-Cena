import type { Dimensions } from "@/types";

const DIMENSION_FORMATTER = new Intl.NumberFormat("sr-Latn-RS", {
  maximumFractionDigits: 2,
});

export function formatProductCardDimensions(dimensions: Dimensions) {
  const values = [dimensions.w, dimensions.d, dimensions.h];
  if (!values.every((value) => Number.isFinite(value) && value > 0)) {
    return "Dimenzije nisu unete";
  }
  return `Dimenzije: ${values
    .map((value) => DIMENSION_FORMATTER.format(value))
    .join(" × ")} cm`;
}
