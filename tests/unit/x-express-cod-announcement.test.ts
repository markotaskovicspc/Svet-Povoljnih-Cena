import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  find: vi.fn(), claim: vi.fn(), update: vi.fn(), event: vi.fn(),
  config: vi.fn(), createOrder: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: {
  shipment: { findUnique: mocks.find, updateMany: mocks.claim, update: mocks.update },
  shipmentEvent: { create: mocks.event },
} }));
vi.mock("@/lib/x-express/config", async (original) => ({
  ...await original<typeof import("@/lib/x-express/config")>(),
  requireXExpressShipmentConfig: mocks.config,
}));
vi.mock("@/lib/x-express/client", () => ({
  XExpressClient: class { createOrder = mocks.createOrder; },
}));

import { announceXExpressShipment } from "@/lib/x-express/shipments";

function preparedShipment() {
  return {
    id: "shipment", provider: "X_EXPRESS", purpose: "ORDER_DELIVERY",
    status: "CREATED", providerShipmentId: null, providerStatusCode: "LOCAL_PREPARED",
    order: { number: "SPC-2026-000001", status: "U_OBRADI", cancelledAt: null,
      paymentMethod: "POUZECE_GOTOVINA", payments: [] },
    rawCreateResponse: {
      createOrderPayload: {
        ContractCode: "U000328", Reference: "shipment", Sender: {}, Recipient: {},
        ServicePayerId: 1, TypeId: 1, Content: "Roba", Waypoints: [],
        Packages: [{ Code: "AAA0850300001", Mass: 1, Content: "Roba" }],
        Options: [{ OptionTypeId: 2, Data: { Name: "SPC", Amount: 3652,
          Account: "340-0001000283004-51", Address: "Beograd" } }],
      },
      xExpressAnnouncement: { state: "PREPARED" },
    },
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.find.mockResolvedValue(preparedShipment());
  mocks.claim.mockResolvedValue({ count: 1 });
  mocks.config.mockReturnValue({ cod: { account: "265-3310310005375-34" } });
  mocks.createOrder.mockResolvedValue({ providerShipmentId: "provider-shipment",
    trackingNo: "AAA0850300001", requestGuid: "request-guid", raw: { accepted: true } });
  mocks.update.mockImplementation(async ({ data }) => data);
});

describe("X Express remittance account at announcement", () => {
  it("updates a stale prepared account without changing COD, parcels or reference", async () => {
    const shipment = preparedShipment();
    mocks.find.mockResolvedValue(shipment);
    const expected = structuredClone(shipment.rawCreateResponse.createOrderPayload);
    expected.Options[0]!.Data.Account = "265-3310310005375-34";

    await announceXExpressShipment(shipment.id);

    expect(mocks.createOrder).toHaveBeenCalledExactlyOnceWith(expected);
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      rawCreateResponse: expect.objectContaining({ createOrderPayload: expected }),
    }) }));
    expect(shipment.rawCreateResponse.createOrderPayload.Options[0]!.Data.Account)
      .toBe("340-0001000283004-51");
  });

  it("does not add COD to an already paid shipment", async () => {
    const shipment = preparedShipment();
    shipment.order.paymentMethod = "UPLATA_NA_RACUN";
    Object.assign(shipment.order, { payments: [{ status: "PAID" }] });
    Reflect.deleteProperty(shipment.rawCreateResponse.createOrderPayload, "Options");
    mocks.find.mockResolvedValue(shipment);
    mocks.config.mockReturnValue({ cod: {} });

    await announceXExpressShipment(shipment.id);

    expect(mocks.createOrder).toHaveBeenCalledExactlyOnceWith(shipment.rawCreateResponse.createOrderPayload);
    expect(mocks.createOrder.mock.calls[0]![0]).not.toHaveProperty("Options");
  });

  it("does not resend an already announced shipment", async () => {
    const shipment = { ...preparedShipment(), providerShipmentId: "already-announced" };
    mocks.find.mockResolvedValue(shipment);
    await expect(announceXExpressShipment(shipment.id)).resolves.toBe(shipment);
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.createOrder).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("rejects an invalid current account before making a courier request", async () => {
    mocks.config.mockReturnValue({ cod: { account: "265-3310310005375-35" } });
    await expect(announceXExpressShipment("shipment")).rejects.toThrow("MOD97");
    expect(mocks.createOrder).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.claim).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ providerStatusCode: "LOCAL_ANNOUNCEMENT_FAILED" }),
    }));
  });
});
