import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ find: vi.fn(), resolution: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { returnResolution: { findUnique: m.resolution } } }));
vi.mock("@/lib/admin/return-arrival.server", () => ({ findReturnParcel: m.find, confirmReturnParcelArrival: vi.fn() }));
vi.mock("@/lib/admin/reclamation-fulfillment.server", () => ({ receiveReclamationReturn: vi.fn() }));
vi.mock("@/lib/admin/returned-orders.server", () => ({ receiveReturnedOrderUnit: vi.fn() }));
vi.mock("@/lib/admin/order-reshipment.server", () => ({ receiveReshipmentReturn: vi.fn() }));
import { scannedReturnPlan } from "@/lib/admin/scanned-return.server";
import { ReturnReviewRequiredError } from "@/lib/admin/return-review-error";
beforeEach(() => { vi.clearAllMocks(); m.resolution.mockResolvedValue(null); });
describe("resolved parcel review identity", () => {
  const shipment = { id: "s1", orderId: "o1", packageCount: 2, provider: "X_EXPRESS", providerParcelNumbers: ["AAA0850302567", "AAA0850302568"], pickupBatchLines: [], order: { number: "SPC-1", items: [{ id: "i1", sku: "CHAIR", name: "Chair", qty: 2 }] } };
  it("attaches a verified shipment and canonical code for an unlinked reclamation", async () => {
    m.find.mockResolvedValue({ shipment: { ...shipment, reclamation: { id: "r1", orderItemId: "i1", sku: "CHAIR", quantity: 2 } }, code: "AAA0850302567" });
    await expect(scannedReturnPlan("AAA0850302567")).rejects.toMatchObject({ name: "ReturnReviewRequiredError", shipmentId: "s1", parcelNumber: "AAA0850302567" });
  });
  it("marks an unlinked order parcel for the same review flow", async () => {
    m.find.mockResolvedValue({ shipment, code: "AAA0850302567" });
    await expect(scannedReturnPlan("AAA0850302567")).rejects.toBeInstanceOf(ReturnReviewRequiredError);
  });
  it("leaves unknown Ananas consolidation labels unresolved instead of guessing an order", async () => {
    m.find.mockRejectedValue(new Error("Paket nije pronađen."));
    await expect(scannedReturnPlan("KAP0000289404")).rejects.toThrow("Paket nije pronađen");
  });
});
