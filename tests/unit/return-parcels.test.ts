import { describe, expect, it, vi, beforeEach } from "vitest";
import { displayReturnParcelNumber, normalizeReturnParcelNumber, returnParcelNumbers } from "@/lib/admin/return-parcels";
const m = vi.hoisted(() => ({ find: vi.fn(), transaction: vi.fn(), upsert: vi.fn(), lock: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { shipment: { findMany: m.find }, $transaction: m.transaction } }));
vi.mock("@/lib/fiscal/return-lock", () => ({ lockOrderReturn: m.lock }));
import { confirmReturnParcelArrival } from "@/lib/admin/return-arrival.server";
beforeEach(() => {
  vi.clearAllMocks();
  m.transaction.mockImplementation((run) => run({ returnParcelArrival: { upsert: m.upsert } }));
  m.upsert.mockResolvedValue({ id: "arrival" });
});
describe("physical return parcel evidence", () => {
  it("shows every X Express code exactly once, preserving parcel order", () => {
    expect(returnParcelNumbers({ id: "s", trackingNo: "AAA0850300957", providerParcelNumbers: ["AAA0850300957", "AAA0850300958", "AAA0850300959", "AAA0850300960"] })).toEqual(["AAA0850300957", "AAA0850300958", "AAA0850300959", "AAA0850300960"]);
  });
  it("matches GLS numbers from a scanner including their leading zero", () => {
    expect(normalizeReturnParcelNumber("09002829867")).toBe("9002829867");
    expect(displayReturnParcelNumber("9002829867", "MYGLS")).toBe("09002829867");
    expect(returnParcelNumbers({ id: "s", trackingNo: "09002829867", providerParcelNumbers: [9002829867, 9002829868] })).toEqual(["9002829867", "9002829868"]);
  });
  it("records a non-primary numeric parcel idempotently without inventory, fiscal or courier calls", async () => {
    m.find.mockResolvedValue([{ id: "s", orderId: "o", trackingNo: "9002829867", providerParcelNumbers: [9002829867, 9002829868] }]);
    await expect(confirmReturnParcelArrival({ code: "09002829868", actorId: "admin" })).resolves.toMatchObject({ orderId: "o" });
    expect(m.find).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ OR: expect.arrayContaining([{ providerParcelNumbers: { array_contains: [9002829868] } }]) }) }));
    expect(m.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { shipmentId_parcelNumber: { shipmentId: "s", parcelNumber: "9002829868" } }, update: {} }));
    expect(m.lock).toHaveBeenCalledWith(expect.anything(), "o");
  });
  it("rejects missing and ambiguous parcel identities without writing", async () => {
    m.find.mockResolvedValue([]);
    await expect(confirmReturnParcelArrival({ code: "AAA12345", actorId: "admin" })).rejects.toThrow("nije pronađen");
    m.find.mockResolvedValue([{ id: "a" }, { id: "b" }]);
    await expect(confirmReturnParcelArrival({ code: "AAA12345", actorId: "admin" })).rejects.toThrow("više pošiljki");
    expect(m.transaction).not.toHaveBeenCalled();
  });
  it("validates scanner input before querying", async () => {
    await expect(confirmReturnParcelArrival({ code: "<x>", actorId: "admin" })).rejects.toThrow("važeći kod");
    expect(m.find).not.toHaveBeenCalled();
  });
});
