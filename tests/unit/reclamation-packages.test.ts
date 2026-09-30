import { describe, expect, it } from "vitest";
import { parseReclamationPackages } from "@/lib/admin/reclamation-packages";
import { resolveCourierProvider, physicalPackageRouteItem } from "@/lib/courier/routing";

const parcel = { weightKg: 0.2, widthCm: 10, depthCm: 5, heightCm: 2 };
describe("measured replacement parcels", () => {
  it.each([null, [], [{ ...parcel, weightKg: 0 }], [{ ...parcel, widthCm: -1 }], [{ weightKg: 1 }], [{ ...parcel, heightCm: NaN }]])("rejects missing or invalid dimensions: %j", (value) => {
    expect(() => parseReclamationPackages(value)).toThrow("Mere zamene");
  });
  it("routes a small part to X Express and mixed parcel sizes wholly to MyGLS", () => {
    const route = (values: unknown) => resolveCourierProvider({ shippingMethod: "KURIR", items: parseReclamationPackages(values).map((pkg, i) => physicalPackageRouteItem({ ...pkg, packageNo: i + 1 })) });
    expect(route([parcel])).toMatchObject({ kind: "single", provider: "X_EXPRESS" });
    expect(route([parcel, { ...parcel, widthCm: 61 }])).toMatchObject({ kind: "single", provider: "MYGLS" });
  });
  it("rejects hard courier limits before a replacement becomes ready", () => {
    expect(() => parseReclamationPackages([{ ...parcel, weightKg: 41 }])).toThrow("40 kg");
    expect(() => parseReclamationPackages([{ ...parcel, widthCm: 201 }])).toThrow("200 cm");
  });
});
