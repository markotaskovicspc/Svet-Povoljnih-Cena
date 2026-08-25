import { describe, expect, it } from "vitest";
import { inferMyGlsShipmentStatus } from "@/lib/mygls/status";

describe("MyGLS status mapping", () => {
  it.each([
    ["51", "Data sent"],
    ["52", "COD data sent"],
  ])("keeps informational status %s as a created shipment", (code, label) => {
    expect(inferMyGlsShipmentStatus(code, label)).toBe("CREATED");
  });

  it("recognizes an informational text even without a known numeric code", () => {
    expect(inferMyGlsShipmentStatus("", "Parcel registered")).toBe("CREATED");
  });

  it("does not weaken a real failure status", () => {
    expect(inferMyGlsShipmentStatus("11", "Delivery failed")).toBe("FAILED");
  });
});
