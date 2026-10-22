import { describe, expect, it } from "vitest";
import { pickingVolume, formatPickingVolume } from "@/lib/admin/picking-volume";
const parcel = { id: "p1", purpose: "ORDER_DELIVERY", widthCm: "50", depthCm: "40", heightCm: "30" };
describe("picking parcel volume", () => {
  it("counts each physical parcel once, independent of item quantity or shared contents", () => {
    const volume = pickingVolume([parcel, parcel, { ...parcel, id: "p2", widthCm: 100 }]);
    expect(volume).toEqual({ knownM3: 0.18, missingPackages: 0, packageCount: 2 });
    expect(formatPickingVolume(volume)).toBe("0,180 m³");
  });
  it("retains cancelled deliveries while excluding deferred parcels and incoming returns", () => {
    expect(pickingVolume([parcel, { ...parcel, id: "p2", deferredAt: new Date() },
      { ...parcel, id: "p3", order: { status: "OTKAZANO" } },
      { ...parcel, id: "p4", purpose: "RECLAMATION_RETURN" },
      { ...parcel, id: "p5", purpose: "RECLAMATION_REPLACEMENT", order: { status: "OTKAZANO" } },
    ])).toEqual({ knownM3: 0.18, missingPackages: 0, packageCount: 3 });
  });
  it("marks partial totals explicitly when dimensions are absent, zero or invalid", () => {
    const result = pickingVolume([parcel, ...[null, 0, "bad", -1].map((heightCm, i) => ({ ...parcel, id: String(i), heightCm }))]);
    expect(result).toEqual({ knownM3: 0.06, missingPackages: 4, packageCount: 5 });
    expect(formatPickingVolume(result)).toContain("nepotpuno — nedostaju mere za 4 paketa");
    expect(pickingVolume([])).toEqual({ knownM3: 0, missingPackages: 0, packageCount: 0 });
  });
});
