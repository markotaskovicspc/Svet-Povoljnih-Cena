import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ find: vi.fn(), update: vi.fn(), town: vi.fn(), lock: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { $transaction: async (fn: (tx: unknown) => unknown) => fn({
  $queryRaw: mocks.lock, reclamation: { findUniqueOrThrow: mocks.find, update: mocks.update }, xExpressTown: { findFirst: mocks.town },
}) } }));
import { saveReclamationAddress } from "@/lib/admin/reclamation-address.server";
import { withReclamationAddress, reclamationAddressDefaults } from "@/lib/reclamation-address";
const address = { shipFirstName: "Test", shipLastName: "Kupac", shipPhone: "0641234567", shipStreet: "Nova", shipHouseNumber: "12A", shipCity: "Novi Sad", shipPostalCode: "21000", shipXExpressTownId: 100 };
beforeEach(() => {
  vi.clearAllMocks(); mocks.find.mockResolvedValue({ customerAddress: null, shipments: [], pickupBatchLines: [] });
  mocks.town.mockResolvedValue({ id: 100, name: "Novi Sad", postalCode: "21000" });
});
describe("reclamation address", () => {
  it("keeps the sale unchanged and clears routing data belonging to the former address", () => {
    const order = { ...address, shipStreet: "Stara", shipXExpressStreetId: 23, glsDeliveryPointId: "old-locker", glsDeliveryPointAddress: "Stari paketomat", shipCompanyName: "Stara firma", items: [1] };
    const effective = withReclamationAddress(order, address);
    expect(effective).toMatchObject({ ...address, shipXExpressStreetId: null, glsDeliveryPointId: null, glsDeliveryPointAddress: null, shipCompanyName: null, items: [1] });
    expect(order.shipStreet).toBe("Stara"); expect(withReclamationAddress(order, null)).toBe(order);
    expect(reclamationAddressDefaults({ ...address, shipStreet: "Nova (12A)", shipHouseNumber: null }, null).shipStreet).toBe("Nova");
  });
  it("saves only the reclamation override and returns an audit diff", async () => {
    expect(await saveReclamationAddress("r1", address)).toEqual({ before: null, after: address });
    expect(mocks.update).toHaveBeenCalledWith({ where: { id: "r1" }, data: { customerAddress: address } });
    expect(mocks.lock).toHaveBeenCalledOnce();
  });
  it.each([{ status: "CREATED" }, { status: "FAILED", provider: "MYGLS", purpose: "RECLAMATION_RETURN", rawCreateResponse: { myGlsReturn: { state: "UNKNOWN" } } }])("blocks a courier request already sent or with uncertain outcome: %j", async shipment => {
    mocks.find.mockResolvedValue({ shipments: [shipment], pickupBatchLines: [] });
    await expect(saveReclamationAddress("r1", address)).rejects.toThrow("otkažite");
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("allows a cancelled request and an unlocked picking draft", async () => {
    mocks.find.mockResolvedValue({ shipments: [{ status: "FAILED", provider: "MYGLS", purpose: "RECLAMATION_RETURN", syncError: "MyGLS etiketa obrisana." }], pickupBatchLines: [{ batch: { status: "DRAFT" } }] });
    await expect(saveReclamationAddress("r1", address)).resolves.toBeDefined();
  });
  it("blocks edits once picking labels have started", async () => {
    mocks.find.mockResolvedValue({ shipments: [], pickupBatchLines: [{ batch: { status: "DRAFT", labelsCreationStartedAt: new Date() } }] });
    await expect(saveReclamationAddress("r1", address)).rejects.toThrow("Adresnice");
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("rejects an old courier town ID after the city changes", async () => {
    await expect(saveReclamationAddress("r1", { ...address, shipCity: "Niš" })).rejects.toThrow("Ponovo izaberite");
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("accepts verified courier locality aliases", async () => {
    mocks.town.mockResolvedValue({ id: 791059, name: "Beograd (Zemun)", postalCode: "11080" });
    await expect(saveReclamationAddress("r1", { ...address, shipCity: "Batajnica", shipPostalCode: "11273", shipXExpressTownId: 791059 })).resolves.toBeDefined();
  });
  it.each([{ shipHouseNumber: "?" }, { shipPostalCode: "xx" }, { shipPhone: "123456" }])("rejects invalid address data: %j", async patch => {
    await expect(saveReclamationAddress("r1", { ...address, ...patch })).rejects.toThrow();
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
