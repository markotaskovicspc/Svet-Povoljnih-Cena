import { describe, expect, it } from "vitest";
import {
  resolveCourierProvider,
  routePackages,
  routeService,
} from "@/lib/courier/routing";

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

  it("routes by the 60 cm dimension rule, regardless of weight", () => {
    expect(
      routeService({
        shippingMethod: "KURIR",
        items: [{ withAssembly: false, packGrossWeightKg: 30.01 }],
      }),
    ).toBe("COURIER_SMALL");
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

  it("keeps a small package on X Express even beside a GLS package", () => {
    const plan = routePackages({
      shippingMethod: "KURIR",
      items: [
        { withAssembly: false, packWidthCm: 70 },
        { withAssembly: false, packWidthCm: 30 },
      ],
    });
    expect(plan.map((item) => [item.courier, item.label])).toEqual([
      ["GLS", "1/1"],
      ["X_EXPRESS", "1/1"],
    ]);
  });

  it("resolves one provider only when every dimension is known", () => {
    expect(
      resolveCourierProvider({
        shippingMethod: "KURIR",
        items: [
          {
            withAssembly: false,
            packWidthCm: 60,
            packDepthCm: 40,
            packHeightCm: 30,
          },
        ],
      }),
    ).toEqual({ kind: "single", provider: "X_EXPRESS" });
    expect(
      resolveCourierProvider({
        shippingMethod: "KURIR",
        items: [
          {
            withAssembly: false,
            packWidthCm: 60.01,
            packDepthCm: 40,
            packHeightCm: 30,
          },
        ],
      }),
    ).toEqual({ kind: "single", provider: "MYGLS" });
    expect(
      resolveCourierProvider({
        shippingMethod: "KURIR",
        items: [{ withAssembly: false, packWidthCm: 30 }],
      }),
    ).toEqual({ kind: "invalid_dimensions" });
  });

  it("marks an order that needs both couriers as mixed", () => {
    expect(
      resolveCourierProvider({
        shippingMethod: "KURIR",
        items: [
          { withAssembly: false, packWidthCm: 70, packDepthCm: 20, packHeightCm: 20 },
          { withAssembly: false, packWidthCm: 30, packDepthCm: 20, packHeightCm: 20 },
        ],
      }),
    ).toEqual({ kind: "mixed" });
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
