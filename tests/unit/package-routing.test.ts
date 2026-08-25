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

  it("routes packages over 30 kg or 60 cm through MyGLS", () => {
    expect(
      routeService({
        shippingMethod: "KURIR",
        items: [{
          withAssembly: false,
          packWidthCm: 30,
          packDepthCm: 20,
          packHeightCm: 10,
          packGrossWeightKg: 30.01,
        }],
      }),
    ).toBe("COURIER_BULKY");
    expect(
      routeService({
        shippingMethod: "KURIR",
        items: [
          {
            withAssembly: false,
            packWidthCm: 60.01,
            packDepthCm: 20,
            packHeightCm: 10,
            packGrossWeightKg: 12,
          },
        ],
      }),
    ).toBe("COURIER_BULKY");
  });

  it("keeps every package together on MyGLS when one package is bulky", () => {
    const plan = routePackages({
      shippingMethod: "KURIR",
      items: [
        { withAssembly: false, packWidthCm: 70, packDepthCm: 20, packHeightCm: 10, packGrossWeightKg: 12 },
        { withAssembly: false, packWidthCm: 30, packDepthCm: 20, packHeightCm: 10, packGrossWeightKg: 12 },
      ],
    });
    expect(plan.map((item) => [item.courier, item.label])).toEqual([
      ["GLS", "1/2"],
      ["GLS", "2/2"],
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
            packGrossWeightKg: 30,
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
            packGrossWeightKg: 12,
          },
        ],
      }),
    ).toEqual({ kind: "single", provider: "MYGLS" });
    expect(
      resolveCourierProvider({
        shippingMethod: "KURIR",
        items: [
          {
            withAssembly: false,
            packWidthCm: 60,
            packDepthCm: 40,
            packHeightCm: 30,
            packGrossWeightKg: 30.01,
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

  it("requires complete dimensions and package weight", () => {
    expect(
      resolveCourierProvider({
        shippingMethod: "KURIR",
        items: [{
          withAssembly: false,
          packWidthCm: 30,
          packDepthCm: 20,
          packHeightCm: 10,
        }],
      }),
    ).toEqual({ kind: "invalid_dimensions" });
  });

  it("routes an order with different package sizes entirely to MyGLS", () => {
    expect(
      resolveCourierProvider({
        shippingMethod: "KURIR",
        items: [
          { withAssembly: false, packWidthCm: 70, packDepthCm: 20, packHeightCm: 20, packGrossWeightKg: 12 },
          { withAssembly: false, packWidthCm: 30, packDepthCm: 20, packHeightCm: 20, packGrossWeightKg: 12 },
        ],
      }),
    ).toEqual({ kind: "single", provider: "MYGLS" });
  });

  it("numbers all packages once for the selected courier", () => {
    const plan = routePackages({
      shippingMethod: "KURIR",
      items: [
        { withAssembly: false, packWidthCm: 70, packDepthCm: 20, packHeightCm: 10, packGrossWeightKg: 12 },
        { withAssembly: false, qty: 2, packQty: 1, packWidthCm: 30, packDepthCm: 20, packHeightCm: 10, packGrossWeightKg: 12 },
      ],
    });
    expect(plan.map((item) => [item.courier, item.label])).toEqual([
      ["GLS", "1/3"],
      ["GLS", "2/3"],
      ["GLS", "3/3"],
    ]);
  });
});
