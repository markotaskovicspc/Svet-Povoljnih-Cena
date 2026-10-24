import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ receipts: vi.fn(), claims: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: {
  stockMovement: { findMany: mocks.receipts },
  reclamation: { findMany: mocks.claims },
} }));
import { reclamationWarehouseStatuses } from "@/lib/admin/reclamation-warehouse-status.server";
import { getOperationalErpRows, operationalErpModules } from "@/lib/admin/erp-operations";
import { gridValueMatchesFilter } from "@/lib/admin/grid-query";
import type { ReclamationWarehouseClaim } from "@/lib/admin/reclamation-warehouse-status";

const claim: ReclamationWarehouseClaim = {
  id: "claim-1", orderId: "order-1", quantity: 2,
  request: "POVRACAJ_NOVCA", resolution: "POVRAT_NOVCA", warehouseStatus: "READY",
};
beforeEach(() => { vi.clearAllMocks(); mocks.receipts.mockResolvedValue([]); });

describe("reclamation warehouse return status", () => {
  it("does not treat READY or saving the warehouse as a goods receipt", async () => {
    const statuses = await reclamationWarehouseStatuses([claim]);
    expect(statuses.get(claim.id)).toBe("AWAITING_RETURN");
  });
  it("keeps a partial intake distinct from full delivery", async () => {
    mocks.receipts.mockResolvedValue([{ idempotencyKey: "reclamation-return:claim-1:parcel:p1", qty: 1 }]);
    expect((await reclamationWarehouseStatuses([claim])).get(claim.id)).toBe("PARTIALLY_RECEIVED");
    mocks.receipts.mockResolvedValue([
      { idempotencyKey: "reclamation-return:claim-1:parcel:p1", qty: 1 },
      { idempotencyKey: "reclamation-return:claim-1:parcel:p2", qty: 1 },
    ]);
    expect((await reclamationWarehouseStatuses([claim])).get(claim.id)).toBe("DELIVERED");
  });
  it("recognizes historical whole-claim receipts without counting parcel receipts twice", async () => {
    mocks.receipts.mockResolvedValue([
      { idempotencyKey: "reclamation-return:claim-1", qty: 1 },
      { idempotencyKey: "reclamation-return:claim-1:parcel:p1", qty: 1 },
    ]);
    expect((await reclamationWarehouseStatuses([claim])).get(claim.id)).toBe("PARTIALLY_RECEIVED");
    mocks.receipts.mockResolvedValue([{ idempotencyKey: "reclamation-return:claim-1", qty: 2 }]);
    expect((await reclamationWarehouseStatuses([claim])).get(claim.id)).toBe("DELIVERED");
  });
  it("does not attribute another claim's intake or a similarly prefixed key", async () => {
    mocks.receipts.mockResolvedValue([
      { idempotencyKey: "reclamation-return:claim-10", qty: 2 },
      { idempotencyKey: "reclamation-return:claim-1:other", qty: 2 },
      { idempotencyKey: "fiscal-return:claim-1", qty: 2 },
    ]);
    expect((await reclamationWarehouseStatuses([claim])).get(claim.id)).toBe("AWAITING_RETURN");
  });
  it("batches receipts for multiple claims on the same order", async () => {
    mocks.receipts.mockResolvedValue([{ idempotencyKey: "reclamation-return:claim-1", qty: 2 }]);
    const statuses = await reclamationWarehouseStatuses([claim, { ...claim, id: "claim-2" }]);
    expect(statuses.get("claim-1")).toBe("DELIVERED");
    expect(statuses.get("claim-2")).toBe("AWAITING_RETURN");
    expect(mocks.receipts).toHaveBeenCalledExactlyOnceWith({ where: {
      orderId: { in: ["order-1"] }, kind: "REFUND_RETURN", idempotencyKey: { startsWith: "reclamation-return:" },
    }, select: { idempotencyKey: true, qty: true } });
  });
  it("preserves replacement preparation, including a changed refund request", async () => {
    expect((await reclamationWarehouseStatuses([{ ...claim, resolution: "ZAMENA_DELA" }])).get(claim.id)).toBe("READY");
    expect(mocks.receipts).not.toHaveBeenCalled();
  });
  it("also recognizes receipt before the refund decision is entered", async () => {
    mocks.receipts.mockResolvedValue([{ idempotencyKey: "reclamation-return:claim-1", qty: 2 }]);
    expect((await reclamationWarehouseStatuses([{ ...claim, resolution: null }])).get(claim.id)).toBe("DELIVERED");
  });
  it("preserves cancellation without a receipt", async () => {
    expect((await reclamationWarehouseStatuses([{ ...claim, warehouseStatus: "CANCELLED" }])).get(claim.id)).toBe("CANCELLED");
  });
  it("returns no rows without querying receipts", async () => {
    expect((await reclamationWarehouseStatuses([])).size).toBe(0);
    expect(mocks.receipts).not.toHaveBeenCalled();
  });
  it("uses the intake status in journal rows, filters, and export data", async () => {
    mocks.claims.mockResolvedValue([{ ...claim, number: "R-1", order: { number: "SPC-1" }, customerFirst: "Test", customerLast: "Kupac" }]);
    mocks.receipts.mockResolvedValue([{ idempotencyKey: "reclamation-return:claim-1", qty: 2 }]);
    const rows = await getOperationalErpRows("reklamacije-dnevnik", 100);
    expect(rows[0].values.warehouseStatus).toBe("DELIVERED");
    expect(gridValueMatchesFilter(rows[0].values.warehouseStatus, { id: "filter", columnKey: "warehouseStatus", operator: "equals", value: "DELIVERED" })).toBe(true);
    const column = operationalErpModules.find((module) => module.slug === "reklamacije-dnevnik")?.columns.find((column) => column.key === "warehouseStatus");
    expect(column?.options).toContain("DELIVERED");
    expect(column?.optionLabels?.DELIVERED).toBe("Primljeno u magacin");
    expect(column?.statusToneByValue?.DELIVERED).toBe("green");
  });
});
