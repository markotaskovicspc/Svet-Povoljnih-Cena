import { describe, expect, it } from "vitest";
import { isMorningPickingTime, pickingReview } from "@/lib/admin/picking-review";
const row = { key: "a", sku: "001", name: "Artikal", barcode: null, quantity: 3, warehouseName: "DC", positions: [1], routeOrder: 1,
  allocations: [{ orderId: "o1", orderNumber: "26-01", quantity: 2 }, { orderId: "o2", orderNumber: "26-02", quantity: 1 }] };
describe("picking review", () => {
  it("does not treat zero with no confirmation as a reviewed shortage", () => {
    expect(pickingReview({ rows: [row], progress: {}, reviewedRows: [] })).toMatchObject({ complete: false, reviewed: false });
  });
  it("accepts explicit zero and keeps all affected orders without guessing allocation", () => {
    const review = pickingReview({ rows: [row], progress: { a: 0 }, reviewedRows: ["a"] });
    expect(review).toMatchObject({ complete: false, reviewed: true, shortages: [{ missing: 3, picked: 0, orders: [{ number: "26-01", quantity: 2 }, { number: "26-02", quantity: 1 }] }] });
  });
  it("keeps a partial count and permits labels only for full picking", () => {
    expect(pickingReview({ rows: [row], progress: { a: 2 }, reviewedRows: ["a"] }).shortages[0].missing).toBe(1);
    expect(pickingReview({ rows: [row], progress: { a: 3 }, reviewedRows: [] })).toEqual({ complete: true, reviewed: true, shortages: [] });
  });
  it("uses 04:00 Serbian time in summer and winter, including the DST transition", () => {
    for (const day of ["2026-10-14T02:00:00Z", "2026-10-25T03:00:00Z", "2026-12-01T03:00:00Z"]) expect(isMorningPickingTime(new Date(day))).toBe(true);
    for (const day of ["2026-10-14T03:00:00Z", "2026-10-25T02:00:00Z", "2026-12-01T02:00:00Z"]) expect(isMorningPickingTime(new Date(day))).toBe(false);
  });
});
