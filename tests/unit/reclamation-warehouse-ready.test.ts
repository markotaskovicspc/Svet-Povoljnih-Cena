import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ find: vi.fn(), update: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: { $transaction: async (fn: (tx: unknown) => unknown) => fn({ $queryRaw: vi.fn(), reclamation: { findUniqueOrThrow: mocks.find, update: mocks.update }, warehouse: { findFirst: async () => ({ id: "warehouse-1" }) } }) } }));
import { saveReclamationWarehouse } from "@/lib/admin/reclamation-fulfillment.server";
const packages = [{ weightKg: 2, widthCm: 5, depthCm: 5, heightCm: 25 }];
beforeEach(() => {
  vi.clearAllMocks();
  mocks.find.mockResolvedValue({ decision: "PRIHVACENA", resolution: "ZAMENA_DELA", resolutionNote: "16 nogica", pickupBatchLines: [], shipments: [] });
  mocks.update.mockResolvedValue({ id: "claim-1" });
});
it("marks a measured replacement ready when warehouse is saved without a status", async () => {
  await saveReclamationWarehouse({ reclamationId: "claim-1", warehouseId: "warehouse-1", packages, actorId: "operator-1" });
  expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ warehouseStatus: "READY", replacementReadyAt: expect.any(Date), replacementReadyById: "operator-1", replacementPackages: packages }) }));
});
it("does not mark ready without measured packages", async () => {
  await expect(saveReclamationWarehouse({ reclamationId: "claim-1", warehouseId: "warehouse-1" })).rejects.toThrow();
  expect(mocks.update).not.toHaveBeenCalled();
});
it("does not modify replacement already loaded into picking", async () => {
  mocks.find.mockResolvedValue({ pickupBatchLines: [{ id: "line-1" }], shipments: [] });
  await expect(saveReclamationWarehouse({ reclamationId: "claim-1", warehouseId: "warehouse-1", packages })).rejects.toThrow("picking");
  expect(mocks.update).not.toHaveBeenCalled();
});
