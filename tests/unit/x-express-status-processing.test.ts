import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  queuedEvents: vi.fn(), shipment: vi.fn(), updateShipment: vi.fn(), updateWebhook: vi.fn(),
  dictionary: vi.fn(), applyEvent: vi.fn(), findShipments: vi.fn(), updateRun: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: {
  xExpressWebhookEvent: { findMany: mocks.queuedEvents, update: mocks.updateWebhook },
  shipment: { findFirst: mocks.shipment, findMany: mocks.findShipments, update: mocks.updateShipment },
  courierStatusCode: { findUnique: mocks.dictionary },
  courierSyncRun: { create: vi.fn(async () => ({ id: "run" })), update: mocks.updateRun },
} }));
vi.mock("@/lib/courier/registry", () => ({ applyShipmentEvent: mocks.applyEvent }));
vi.mock("@/lib/x-express/config", () => ({ X_EXPRESS_PROVIDER: "X_EXPRESS", requireXExpressEnabled: vi.fn(() => ({})) }));
vi.mock("@/lib/email", () => ({ loadOrderForEmail: vi.fn(), sendOrderStatusChanged: vi.fn() }));
vi.mock("@/lib/background-jobs", () => ({ enqueueBackgroundJob: vi.fn() }));

import { processXExpressWebhookNotifyIds } from "@/lib/x-express/webhook";
import { syncXExpressShipmentStatuses } from "@/lib/x-express/sync";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.shipment.mockResolvedValue({ id: "shipment", orderId: "order", trackingNo: "tracking" });
  mocks.applyEvent.mockResolvedValue({ orderId: "order", status: "IN_TRANSIT", eventCreated: true, stateApplied: true, customerEmail: null });
  mocks.dictionary.mockResolvedValue(null);
  mocks.findShipments.mockResolvedValue([]);
});

describe("X Express status processing", () => {
  it.each([
    ["RETURNING", "IN_TRANSIT", "Kreiran povrat"],
    ["DLV_FAIL_ADDRESS_ERR", "FAILED", "Netačna adresa"],
  ])("preserves the %s description in the shipment event", async (code, status, message) => {
    mocks.queuedEvents.mockResolvedValue([{ id: "event", notifyId: "notify", referenceId: "shipment", statusCode: code, statusTime: new Date(), raw: {} }]);
    await expect(processXExpressWebhookNotifyIds(["notify"])).resolves.toEqual({ read: 1, processed: 1, failed: 0 });
    expect(mocks.applyEvent).toHaveBeenCalledWith("COURIER_SMALL", expect.objectContaining({ status, message, providerStatusCode: code }));
  });

  it("saves the provider dictionary label for other delivery problems", async () => {
    mocks.dictionary.mockResolvedValue({ label: "Primalac odsutan" });
    mocks.queuedEvents.mockResolvedValue([{ id: "event", notifyId: "notify", referenceId: "shipment", statusCode: "DLV_FAIL_ABSENT", statusTime: new Date(), raw: {} }]);
    await processXExpressWebhookNotifyIds(["notify"]);
    expect(mocks.applyEvent).toHaveBeenCalledWith("COURIER_SMALL", expect.objectContaining({ status: "FAILED", message: "Primalac odsutan" }));
  });

  it("keeps polling failed attempts for redelivery and return events", async () => {
    await syncXExpressShipmentStatuses();
    const where = mocks.findShipments.mock.calls[0][0].where;
    expect(where.OR[1].status.in).toContain("FAILED");
    expect(where.OR[0].status.notIn).toContain("RETURNED");
    expect(where.AND[0].OR).toContainEqual({ providerStatusCode: { not: "ADDRESS_REPLACED" } });
  });
});
