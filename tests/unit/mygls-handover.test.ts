import { describe, expect, it } from "vitest";
import { buildMyGlsHandover, myGlsHandoverReport } from "@/lib/mygls/handover";
import { normalizeMyGlsStatusResponses } from "@/lib/mygls/status";
import { pickupBatchHandoverProgress, pickupCourierSnapshot } from "@/lib/admin/pickup-batch";

const numbers = [9002739022, 9002739023];
const at = new Date("2026-09-14T09:47:33Z");
const events = normalizeMyGlsStatusResponses({ ParcelList: numbers.map((ParcelNumber, index) => ({
  ParcelNumber, ParcelStatusList: [
    { StatusCode: "51", StatusDate: "2026-09-14T04:46:30Z" },
    ...(index ? [{ StatusCode: "86", StatusDate: at.toISOString() }] : []),
  ],
})) }, numbers);

describe("GLS physical parcel handover", () => {
  it("counts only the scanned parcel, ignoring response ordering and stale whole-order markers", () => {
    const snapshot = buildMyGlsHandover(numbers, [...events].reverse());
    expect(snapshot.parcels).toEqual([{ parcelNumber: numbers[0], pickedUpAt: null }, { parcelNumber: numbers[1], pickedUpAt: at.toISOString() }]);
    const report = myGlsHandoverReport(snapshot);
    expect(report).toMatchObject({ source: "MYGLS", expectedPackages: 2, pickedUpPackages: 1 });
    const courier = pickupCourierSnapshot({ provider: "MYGLS", purpose: "ORDER_DELIVERY", reclamationId: null,
      orderItemId: "item", courierPickedUpAt: at,
      shipments: [{ id: "s", provider: "MYGLS", purpose: "ORDER_DELIVERY", reclamationId: null, status: "PICKED_UP",
        shippedAt: at, lastStatusEventAt: at, createdAt: at, updatedAt: at, rawCreateResponse: { packageHandover: report } }],
    });
    expect(courier).toMatchObject({ pickedUpAt: null, label: "Delimično preuzeto (1/2)" });
    expect(pickupBatchHandoverProgress(numbers.map(() => ({ lineGroupKey: "g", courierPickedUpAt: at, handoverReport: report })))).toMatchObject({ pickedUpPackages: 1, pickedUpGroups: 0 });
  });
  it("rejects an omitted parcel rather than replacing known warehouse evidence", () => {
    expect(() => buildMyGlsHandover(numbers, events.filter(e => e.parcelNumber === numbers[1]))).toThrow("potpun");
  });
  it("counts depot progress as pickup proof but never notification 99", () => {
    const progress = normalizeMyGlsStatusResponses({ ParcelList: numbers.map((ParcelNumber, index) => ({
      ParcelNumber, ParcelStatusList: [{ StatusCode: index ? "03" : "99", StatusDate: at.toISOString() }, { StatusCode: "51", StatusDate: "2026-09-14T04:46:30Z" }],
    })) }, numbers);
    expect(myGlsHandoverReport(buildMyGlsHandover(numbers, progress)).pickedUpPackages).toBe(1);
  });
});
