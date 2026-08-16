import { describe, expect, it } from "vitest";
import {
  packageCourierForProvider,
  routePackages,
  routeService,
  singleProviderForOrder,
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

  it("maps provider batches to the documented package class", () => {
    expect(packageCourierForProvider("X_EXPRESS")).toBe("X_EXPRESS");
    expect(packageCourierForProvider("MYGLS")).toBe("GLS");
  });

  it("refuses to collapse a mixed order to one provider", () => {
    expect(
      singleProviderForOrder({
        shippingMethod: "KURIR",
        items: [
          { withAssembly: false, packWidthCm: 40 },
          { withAssembly: false, packWidthCm: 80 },
        ],
      }),
    ).toBeNull();
    expect(
      singleProviderForOrder({
        shippingMethod: "KURIR",
        items: [{ withAssembly: false, packWidthCm: 40 }],
      }),
    ).toBe("X_EXPRESS");
    expect(
      singleProviderForOrder({
        shippingMethod: "KURIR",
        items: [{ withAssembly: false, packWidthCm: 80 }],
      }),
    ).toBe("MYGLS");
  });
});
