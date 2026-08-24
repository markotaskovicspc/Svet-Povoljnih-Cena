import { describe, expect, it } from "vitest";
import { dashboardUnitVolumeM3 } from "@/lib/admin/dashboard-logistics";

describe("dashboard warehouse volume", () => {
  it("uses container capacity first when both logistics sources exist", () => {
    expect(
      dashboardUnitVolumeM3({
        containerQty: 230,
        packQty: 2,
        packWidthCm: 100,
        packDepthCm: 50,
        packHeightCm: 40,
      }),
    ).toBeCloseTo(0.3);
  });

  it("divides transport-package volume by pieces in the package", () => {
    expect(
      dashboardUnitVolumeM3({
        packQty: 2,
        packWidthCm: 100,
        packDepthCm: 50,
        packHeightCm: 40,
      }),
    ).toBeCloseTo(0.1);
  });

  it("fails closed when the transport package is incomplete", () => {
    expect(
      dashboardUnitVolumeM3({
        packQty: 2,
        packWidthCm: 100,
        packDepthCm: 50,
        packHeightCm: null,
      }),
    ).toBe(0);
  });
});
