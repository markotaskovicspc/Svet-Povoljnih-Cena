import { describe, expect, it } from "vitest";
import { canReceiveReclamationShipment, assertMyGlsReturnAccepted, myGlsReturnStatusLabel, myGlsReturnBooking } from "@/lib/mygls/return-booking";
const shipment = { provider: "MYGLS", purpose: "RECLAMATION_RETURN", status: "CREATED", providerParcelId: "123", trackingNo: "456" };
describe("P&R evidence and presentation", () => {
  it("does not treat an ordinary label or courierRequestedAt as a booked pickup", () => {
    expect(() => assertMyGlsReturnAccepted(shipment)).toThrow(/Obična adresnica/);
    expect(myGlsReturnStatusLabel(shipment)).toContain("nije potvrđeno");
  });
  it("distinguishes acceptance from physical pickup and recognises the audited manual recovery", () => {
    const accepted = { ...shipment, rawCreateResponse: { myGlsReturn: { state: "ACCEPTED", pickupDate: "2026-09-30" } } };
    expect(() => assertMyGlsReturnAccepted(accepted)).not.toThrow();
    expect(myGlsReturnStatusLabel(accepted)).toContain("čeka preuzimanje");
    expect(myGlsReturnStatusLabel({ ...accepted, status: "PICKED_UP" })).toBe("Preuzeto kod kupca");
    expect(myGlsReturnBooking({ ...shipment, rawCreateResponse: { manualRecovery: { providerServiceCode: "P&R", verifiedAt: "2026-09-29", requestedPickupDate: "2026-09-30" } } })).toMatchObject({ state: "ACCEPTED", pickupDate: "2026-09-30" });
  });
  it("does not claim success for incomplete, unknown or cancelled requests", () => {
    for (const state of ["PENDING", "UNKNOWN"]) {
      expect(() => assertMyGlsReturnAccepted({ ...shipment, rawCreateResponse: { myGlsReturn: { state } } })).toThrow(/Ishod/);
    }
    const rawCreateResponse = { myGlsReturn: { state: "ACCEPTED" } };
    expect(() => assertMyGlsReturnAccepted({ ...shipment, rawCreateResponse, trackingNo: null })).toThrow();
    expect(myGlsReturnBooking({ ...shipment, rawCreateResponse, syncError: "MyGLS etiketa obrisana." }).state).toBe("CANCELLED");
  });
});

it("does not offer warehouse receipt for a P&R package returned to its sender/customer", () => {
  expect(canReceiveReclamationShipment({ ...shipment, status: "RETURNED" })).toBe(false);
  expect(canReceiveReclamationShipment({ ...shipment, status: "DELIVERED" })).toBe(true);
});
