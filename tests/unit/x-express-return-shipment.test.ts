import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  reclamation: vi.fn(), order: vi.fn(), warehouse: vi.fn(), towns: vi.fn(),
  town: vi.fn(), create: vi.fn(), allocate: vi.fn(), checkAddress: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: {
  reclamation: { findUnique: mocks.reclamation }, order: { findUnique: mocks.order },
  warehouse: { findFirst: mocks.warehouse },
  xExpressTown: { findFirst: mocks.town, findUnique: mocks.town, findMany: mocks.towns },
  shipment: { create: mocks.create },
  $transaction: async (fn: (tx: object) => unknown) => fn({}),
} }));
vi.mock("@/lib/x-express/code", () => ({ allocateXExpressTrackingCode: mocks.allocate }));
vi.mock("@/lib/x-express/client", async (original) => ({
  ...await original<typeof import("@/lib/x-express/client")>(),
  XExpressClient: class { checkAddress = mocks.checkAddress; },
}));
vi.mock("@/lib/x-express/config", async (original) => ({
  ...await original<typeof import("@/lib/x-express/config")>(),
  requireXExpressShipmentConfig: () => ({
    contractCode: "U000328", servicePayerId: 2, serviceTypeId: 1,
    defaultContent: "Roba", cod: {},
    pickup: { name: "Druga adresa", townId: 300, streetName: "Druga", streetNumber: "1",
      latitude: 45, longitude: 19, contactName: "Magacin", contactPhone: "0641234567", contactEmail: "" },
  }),
}));

import { createXExpressShipmentForOrder } from "@/lib/x-express/shipments";

const options = {
  purpose: "RECLAMATION_RETURN" as const, reclamationId: "r1", packageCount: 2,
  returnPickupCoordinates: { latitude: 44.81, longitude: 20.46 },
};

describe("X Express reclamation return preparation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.reclamation.mockResolvedValue({ id: "r1", orderId: "o1", orderItemId: "i1", quantity: 1, warehouseId: "w1" });
    mocks.order.mockResolvedValue({
      id: "o1", number: "SPC-1", shippingMethod: "KURIR", paymentMethod: "POUZECE_GOTOVINA", total: 5000,
      shipFirstName: "Petar", shipLastName: "Petrovic", shipPhone: "0642223344",
      shipStreet: "Prva 10", shipCity: "Beograd", shipPostalCode: "11000", shipXExpressTownId: 100,
      items: [{ id: "i1", name: "Lampa", sku: "L1", qty: 5, withAssembly: false, product: { weightKg: 2 } },
        { id: "i2", name: "Drugi artikal", sku: "L2", qty: 1, withAssembly: false }],
      payments: [], shipments: [],
    });
    mocks.warehouse.mockResolvedValue({ name: "Magacin povrata", address: "Evropska bb, 22300 Stara Pazova", city: "Stara Pazova", phone: "0651234567" });
    mocks.towns.mockResolvedValue([{ id: 200, name: "Stara Pazova", postalCode: "22300" }]);
    mocks.town.mockImplementation(async ({ where }: { where: { id: number } }) => ({ id: where.id, name: where.id === 100 ? "Beograd" : "Drugo mesto", postalCode: "11000" }));
    let sequence = 0;
    mocks.allocate.mockImplementation(async () => ({ trackingNo: `AAA085030000${++sequence}` }));
    mocks.checkAddress.mockImplementation(async ({ TownId }: { TownId: number }) => ({ valid: true, area: TownId === 200 ? "PA-01" : "BG-01", raw: { area: TownId === 200 ? "PA-01" : "BG-01" } }));
    mocks.create.mockImplementation(async ({ data }: { data: object }) => ({ ...data }));
  });

  it("checks both addresses and saves the destination route, zero COD and exact pickup snapshot", async () => {
    const shipment = await createXExpressShipmentForOrder("o1", options);
    expect(mocks.allocate).toHaveBeenCalledTimes(2);
    expect(mocks.checkAddress).toHaveBeenCalledTimes(2);
    expect(mocks.checkAddress).toHaveBeenLastCalledWith(expect.objectContaining({ TownId: 200, StreetName: "Evropska", StreetNumber: "bb" }));
    expect(shipment).toMatchObject({ packageCount: 2, providerRouteCode: "PA-01", warehouseId: "w1", reclamationQty: 1 });
    const raw = mocks.create.mock.calls[0][0].data.rawCreateResponse;
    expect(raw.createOrderPayload.Options).toBeUndefined();
    expect(raw.createOrderPayload.ServicePayerId).toBe(1);
    expect(raw.createOrderPayload.Waypoints[0].Address).toMatchObject({ Latitude: 44.81, Longitude: 20.46, TownId: 100 });
    expect(raw.createOrderPayload.Packages).toHaveLength(2);
    expect(raw.labelData.recipient).toMatchObject({ city: "Stara Pazova", streetName: "Evropska" });
    expect(raw.labelData.sender).toMatchObject({ city: "Beograd" });
    expect(raw.labelData.codAmount).toBe(0);
    expect(raw.createOrderPayload.Content).toBe("Lampa");
  });

  it("reuses an existing shipment without another provider call or tracking allocation", async () => {
    const order = await mocks.order();
    mocks.order.mockResolvedValue({ ...order, shipments: [{ id: "existing", provider: "X_EXPRESS", status: "CREATED", rawCreateResponse: {} }] });
    await expect(createXExpressShipmentForOrder("o1", { ...options, returnPickupCoordinates: undefined })).resolves.toMatchObject({ id: "existing" });
    expect(mocks.checkAddress).not.toHaveBeenCalled();
    expect(mocks.allocate).not.toHaveBeenCalled();
  });

  it("requires pickup coordinates before allocating tracking codes", async () => {
    await expect(createXExpressShipmentForOrder("o1", { ...options, returnPickupCoordinates: undefined })).rejects.toThrow(/Lokacija kupca/);
    expect(mocks.allocate).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("does not silently send the return to the configured outbound pickup address", async () => {
    mocks.warehouse.mockResolvedValue({ name: "Magacin", city: "Stara Pazova", address: null });
    await expect(createXExpressShipmentForOrder("o1", options)).rejects.toThrow(/adresu magacina/);
    expect(mocks.allocate).not.toHaveBeenCalled();
    expect(mocks.checkAddress).not.toHaveBeenCalled();
  });
});
