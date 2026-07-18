import { describe, expect, it } from "vitest";
import { routePackages, routeService } from "@/lib/courier/routing";

describe("package routing", () => {
  it("routes a normal package to the small-parcel courier", () => {
    expect(
      routeService({
        shippingMethod: "KURIR",
        items: [
          {
            withAssembly: false,
            packWidthCm: 60,
            packDepthCm: 40,
            packHeightCm: 30,
            packGrossWeightKg: 12,
          },
        ],
      }),
    ).toBe("COURIER_SMALL");
  });

  it("routes a package over 30 kg or 60 cm through GLS", () => {
    expect(
      routeService({
        shippingMethod: "KURIR",
        items: [{ withAssembly: false, packGrossWeightKg: 30.01 }],
      }),
    ).toBe("COURIER_BULKY");
    expect(
      routeService({
        shippingMethod: "KURIR",
        items: [
          {
            withAssembly: false,
            packWidthCm: 60.01,
          },
        ],
      }),
    ).toBe("COURIER_BULKY");
  });

  it("keeps one small package with bulky packages on GLS", () => {
    const plan = routePackages({
      shippingMethod: "KURIR",
      items: [
        { withAssembly: false, packWidthCm: 70 },
        { withAssembly: false, packWidthCm: 30 },
      ],
    });
    expect(plan.map((item) => [item.courier, item.label])).toEqual([
      ["GLS", "1/2"],
      ["GLS", "2/2"],
    ]);
  });

  it("splits two small packages from bulky packages and numbers per courier", () => {
    const plan = routePackages({
      shippingMethod: "KURIR",
      items: [
        { withAssembly: false, packWidthCm: 70 },
        { withAssembly: false, qty: 2, packQty: 1, packWidthCm: 30 },
      ],
    });
    expect(plan.map((item) => [item.courier, item.label])).toEqual([
      ["GLS", "1/1"],
      ["X_EXPRESS", "1/2"],
      ["X_EXPRESS", "2/2"],
    ]);
  });
});
