import { describe, expect, it } from "vitest";
import {
  effectiveMyGlsShipmentStatus,
  inferMyGlsShipmentStatus,
  normalizeMyGlsStatusResponses,
  parseMyGlsStatusDate,
} from "@/lib/mygls/status";

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

  it.each([
    ["86", "Successful pick up", "PICKED_UP"],
    ["01", "APL-Registration", "PICKED_UP"],
    ["03", "Depot Entry", "IN_TRANSIT"],
    ["04", "Delivery list scan", "OUT_FOR_DELIVERY"],
    ["07", "Depot Storage", "IN_TRANSIT"],
    ["09", "Fixed Delivery Day", "IN_TRANSIT"],
  ] as const)("maps production status %s to %s", (code, label, expected) => {
    expect(inferMyGlsShipmentStatus(code, label)).toBe(expected);
  });

  it("parses the timezone suffix returned by the production MyGLS API", () => {
    expect(parseMyGlsStatusDate("/Date(1788354437000+0200)/")?.toISOString()).toBe(
      "2026-09-02T13:07:17.000Z",
    );
  });

  it("treats a stored false failure with a real label as picked up", () => {
    expect(
      effectiveMyGlsShipmentStatus({
        provider: "MYGLS",
        status: "FAILED",
        providerStatusCode: "86",
        labelObjectKey: "mygls/order/shipment.pdf",
        syncError: null,
      }),
    ).toBe("PICKED_UP");
    expect(
      effectiveMyGlsShipmentStatus({
        provider: "MYGLS",
        status: "FAILED",
        providerStatusCode: "86",
        labelObjectKey: null,
        syncError: null,
      }),
    ).toBe("FAILED");
  });

  it("keeps both parcel numbers and globally orders a multi-parcel response", () => {
    const events = normalizeMyGlsStatusResponses(
      {
        ParcelList: [
          {
            ParcelNumber: 9002688815,
            ClientReference: "SPC-2026-000274-P1",
            ParcelStatusList: [
              {
                StatusCode: "07",
                StatusDate: "/Date(1788354419000+0200)/",
                StatusDescription: "Depot Storage",
              },
            ],
          },
          {
            ParcelNumber: 9002688816,
            ClientReference: "SPC-2026-000274-P2",
            ParcelStatusList: [
              {
                StatusCode: "04",
                StatusDate: "/Date(1788354437000+0200)/",
                StatusDescription: "Delivery list scan",
              },
            ],
          },
        ],
      },
      [9002688815, 9002688816],
    );

    expect(events.map((event) => event.parcelNumber)).toEqual([
      9002688816,
      9002688815,
    ]);
    expect(events.map((event) => event.status)).toEqual([
      "OUT_FOR_DELIVERY",
      "IN_TRANSIT",
    ]);
    expect(events[0]?.providerEventId).toBe(
      "MYGLS:9002688816:04:2026-09-02T13:07:17.000Z",
    );
  });
});
