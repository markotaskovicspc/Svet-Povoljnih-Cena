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

it("requires dated delivery proof for every parcel, not the last whole-shipment event", () => {
  const multi = { ...shipment, status: "DELIVERED", packageCount: 2, providerParcelNumbers: [11, 22] };
  expect(canReceiveReclamationShipment(multi)).toBe(false);
  const proof = (status: string) => ({ ...multi, rawCreateResponse: { myGlsParcelHandover: { parcels: [
    { parcelNumber: 11, latestStatus: status, latestStatusAt: "2026-09-30T12:00:00Z" },
    { parcelNumber: 22, latestStatus: "DELIVERED", latestStatusAt: "2026-09-30T12:01:00Z" },
  ] } } });
  expect(canReceiveReclamationShipment(proof("PICKED_UP"))).toBe(false);
  expect(myGlsReturnStatusLabel(proof("PICKED_UP"))).toContain("svih povratnih paketa");
  expect(canReceiveReclamationShipment(proof("DELIVERED"))).toBe(true);
  expect(canReceiveReclamationShipment({ ...proof("DELIVERED"), providerParcelNumbers: [11, 33] })).toBe(false);
});
