import { describe, expect, it } from "vitest";
import { incompletePackageHandover, packageHandoverLabel, readPackageHandoverReport } from "@/lib/courier/package-handover";
import { pickupBatchHandoverProgress, pickupCourierSnapshot } from "@/lib/admin/pickup-batch";
import { salesOrderCourierDisplay } from "@/lib/admin/erp-operations";

const report = {
  version: 1 as const, expectedPackages: 2, pickedUpPackages: 1,
  recordedAt: "2026-09-07T18:00:00.000Z", note: "Preuzet je jedan paket; nije navedeno koji.", source: "USER_REPORT" as const,
};
const at = new Date(report.recordedAt);
const shipment = {
  id: "shipment-1", provider: "X_EXPRESS", purpose: "ORDER_DELIVERY" as const, reclamationId: null,
  status: "PICKED_UP" as const, shippedAt: at, lastStatusEventAt: at, createdAt: at, updatedAt: at,
  rawCreateResponse: { assignment: { orderItemIds: ["chair", "blender"], codAmount: 0 }, packageHandover: report },
};

describe("reported partial package handover", () => {
  it("shows 1/2 consistently without identifying either parcel as picked up", () => {
    for (const itemId of ["chair", "blender"]) {
      const snapshot = pickupCourierSnapshot({ provider: "X_EXPRESS", purpose: "ORDER_DELIVERY", reclamationId: null,
        orderItemId: itemId, courierPickedUpAt: at, shipments: [shipment] });
      expect(snapshot).toMatchObject({ label: "Delimično preuzeto (1/2)", pickedUpAt: null, handoverReport: report });
      expect(salesOrderCourierDisplay({ shippingMethod: "KURIR", itemId, shipments: [shipment] }).status).toBe("Delimično preuzeto (1/2)");
    }
    expect(pickupBatchHandoverProgress([
      { lineGroupKey: "a", courierPickedUpAt: at, handoverReport: report },
      { lineGroupKey: "a", courierPickedUpAt: at, handoverReport: report },
      { lineGroupKey: "b", courierPickedUpAt: at },
    ])).toEqual({ totalGroups: 2, pickedUpGroups: 1, totalPackages: 3, pickedUpPackages: 2 });
  });
  it("keeps the report visible even when the aggregate carrier status advances", () => {
    expect(salesOrderCourierDisplay({ shippingMethod: "KURIR", itemId: "chair", shipments: [{ ...shipment, status: "DELIVERED" }] }).status).toBe("Delimično preuzeto (1/2)");
  });
  it("resumes normal courier status after the remaining package is confirmed", () => {
    const raw = { ...shipment.rawCreateResponse, packageHandover: { ...report, pickedUpPackages: 2 } };
    expect(incompletePackageHandover(raw)).toBeNull();
    expect(packageHandoverLabel(readPackageHandoverReport(raw)!)).toBe("Kompletno preuzeto (2/2)");
    expect(salesOrderCourierDisplay({ shippingMethod: "KURIR", itemId: "chair", shipments: [{ ...shipment, rawCreateResponse: raw }] }).status).toBe("Preuzeto iz magacina");
  });
  it.each([-1, 3, 1.5, "1"])("rejects an invalid reported quantity %s", count => {
    expect(readPackageHandoverReport({ packageHandover: { ...report, pickedUpPackages: count } })).toBeNull();
  });
});
