/**
 * Dashboard stock volume follows the same client rule as purchase orders:
 * container capacity wins, otherwise transport-package dimensions are divided
 * by the number of pieces in that package. Product/unit dimensions are not a
 * transport-volume source.
 */
export function dashboardUnitVolumeM3(input: {
  containerQty?: number | null;
  packQty?: number | null;
  packWidthCm?: number | null;
  packDepthCm?: number | null;
  packHeightCm?: number | null;
}) {
  if (positive(input.containerQty)) return 69 / input.containerQty;
  if (
    positive(input.packQty) &&
    positive(input.packWidthCm) &&
    positive(input.packDepthCm) &&
    positive(input.packHeightCm)
  ) {
    return (
      (input.packWidthCm * input.packDepthCm * input.packHeightCm) /
      1_000_000 /
      input.packQty
    );
  }
  return 0;
}

function positive(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}
