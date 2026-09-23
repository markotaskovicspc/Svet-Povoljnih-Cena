import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  order: vi.fn(), reclamation: vi.fn(), warehouse: vi.fn(), town: vi.fn(), towns: vi.fn(),
  create: vi.fn(), findShipment: vi.fn(), updateShipment: vi.fn(), claim: vi.fn(),
  updateReclamation: vi.fn(), allocate: vi.fn(), checkAddress: vi.fn(), announce: vi.fn(),
  fetch: vi.fn(), inventory: vi.fn(), gls: vi.fn(),
}));
vi.mock("@/lib/db", () => {
  const db = {
    order: { findUnique: mocks.order },
    reclamation: { findUnique: mocks.reclamation, update: mocks.updateReclamation },
    warehouse: { findFirst: mocks.warehouse },
    xExpressTown: { findUnique: mocks.town, findFirst: mocks.town, findMany: mocks.towns },
    shipment: { create: mocks.create, findUnique: mocks.findShipment, update: mocks.updateShipment, updateMany: mocks.claim },
    $transaction: async (fn: (tx: object) => unknown) => fn(db),
  };
  return { db };
});
vi.mock("@/lib/inventory", () => ({ adjustInventory: mocks.inventory, ensureDefaultWarehouse: vi.fn() }));
vi.mock("@/lib/mygls/shipments", () => ({ createMyGlsShipmentForOrder: mocks.gls, deleteMyGlsLabelsForShipment: vi.fn() }));
vi.mock("@/lib/x-express/code", () => ({ allocateXExpressTrackingCode: mocks.allocate }));
vi.mock("@/lib/x-express/client", () => ({
  XExpressClient: class { checkAddress = mocks.checkAddress; createOrder = mocks.announce; },
}));
vi.mock("@/lib/x-express/config", async (original) => ({
  ...await original<typeof import("@/lib/x-express/config")>(),
  requireXExpressShipmentConfig: () => ({
    contractCode: "U000328", servicePayerId: 2, serviceTypeId: 1, defaultContent: "Roba", cod: {},
    pickup: { name: "DC", townId: 300, streetName: "Druga", streetNumber: "1",
      latitude: 45, longitude: 19, contactName: "Magacin", contactPhone: "0641234567", contactEmail: "" },
  }),
}));
import { createReclamationShipment, preflightReclamationShipment } from "@/lib/admin/reclamation-fulfillment.server";

const options = { reclamationId: "r1", purpose: "RECLAMATION_RETURN" as const, packageCount: 2 };

describe("refund pickup with automatic geocoding through the real courier registry", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "test-secret");
    vi.stubGlobal("fetch", mocks.fetch);
    mocks.reclamation.mockResolvedValue({
      id: "r1", orderId: "o1", orderItemId: "i1", quantity: 1, warehouseId: "w1",
      decision: "PRIHVACENA", resolution: "POVRAT_NOVCA", warehouseStatus: "NOT_REQUESTED",
      shipments: [], pickupBatchLines: [],
    });
    const order = {
      id: "o1", number: "TEST-1", shippingMethod: "KURIR", paymentMethod: "POUZECE_GOTOVINA", total: 5000,
      shipFirstName: "Test", shipLastName: "Kupac", shipPhone: "0642223344", shipStreet: "Vladetina 5",
      shipCity: "Beograd", shipPostalCode: "11104", shipXExpressTownId: 100,
      items: [{ id: "i1", name: "Lampa", sku: "L1", qty: 1, withAssembly: false,
        product: { weightKg: 2, unitPackWidthCm: 20, unitPackDepthCm: 20, unitPackHeightCm: 20 } }],
      shipments: [], payments: [],
    };
    mocks.order.mockResolvedValue(order);
    mocks.warehouse.mockResolvedValue({ name: "Povrat", city: "Stara Pazova", address: "Evropska bb, 22300 Stara Pazova", phone: "0651234567" });
    mocks.towns.mockResolvedValue([{ id: 200, name: "Stara Pazova", postalCode: "22300" }]);
    mocks.town.mockImplementation(async ({ where }: { where: { id: number } }) => ({ id: where.id, name: "Beograd", postalCode: "11000" }));
    let number = 0;
    mocks.allocate.mockImplementation(async () => ({ trackingNo: `AAA085030000${++number}` }));
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ status: "OK", results: [{
      types: ["street_address"], geometry: { location_type: "ROOFTOP", location: { lat: 44.81, lng: 20.46 } },
      address_components: [
        { long_name: "Vladetina", short_name: "Vladetina", types: ["route"] },
        { long_name: "5", short_name: "5", types: ["street_number"] },
        { long_name: "Beograd", short_name: "BG", types: ["locality"] },
        { long_name: "Srbija", short_name: "RS", types: ["country"] },
      ],
    }] })));
    mocks.checkAddress.mockResolvedValue({ area: "PA-01", raw: { area: "PA-01" }, valid: true });
    mocks.create.mockImplementation(async ({ data }: { data: object }) => {
      const shipment = { ...data, id: "s1", order };
      mocks.findShipment.mockResolvedValue(shipment);
      mocks.updateShipment.mockImplementation(async ({ data: patch }: { data: object }) => ({ ...shipment, ...patch }));
      return shipment;
    });
    mocks.claim.mockResolvedValue({ count: 1 });
    mocks.announce.mockResolvedValue({ providerShipmentId: "test-provider-id", requestGuid: "test-guid", raw: {} });
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  it("finds the customer, prepares two zero-COD parcels, announces once and updates the reclamation", async () => {
    const shipment = await createReclamationShipment(options);
    expect(shipment.providerShipmentId).toBe("test-provider-id");
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.announce).toHaveBeenCalledTimes(1);
    const payload = mocks.announce.mock.calls[0][0];
    expect(payload.Waypoints.find((w: { WaypointType: string }) => w.WaypointType === "PICKUP").Address).toMatchObject({ TownId: 100, Latitude: 44.81, Longitude: 20.46 });
    expect(payload.Waypoints.find((w: { WaypointType: string }) => w.WaypointType === "DELIVERY").Address.TownId).toBe(200);
    expect(payload.Options).toBeUndefined();
    expect(payload.Packages).toHaveLength(2);
    expect(payload.ServicePayerId).toBe(1);
    expect(mocks.updateReclamation).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ warehouseStatus: "REQUESTED" }) }));
    expect(mocks.inventory).not.toHaveBeenCalled();
    expect(mocks.gls).not.toHaveBeenCalled();
  });

  it("preflight verifies the address without allocating, saving or announcing any shipment", async () => {
    await preflightReclamationShipment(options);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.allocate).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.announce).not.toHaveBeenCalled();
  });

  it("stops the full workflow on an unresolved address without changing reclamation state", async () => {
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ status: "ZERO_RESULTS", results: [] })));
    await expect(createReclamationShipment(options)).rejects.toThrow(/Proverite ulicu/);
    expect(mocks.allocate).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.announce).not.toHaveBeenCalled();
    expect(mocks.updateReclamation).not.toHaveBeenCalled();
  });
});
