import { describe, expect, it } from "vitest";
import { buildPickingPlan, pickingLayout, validatePickingDelta, type PositionedLine } from "@/lib/admin/picking-plan";
const line = (patch: Partial<PositionedLine> = {}): PositionedLine => ({ id: "l1", orderId: "o1", orderNumber: "P1", lineGroupKey: "o1", quantity: 2, warehouseId: "dc", warehouseName: "DC", supplierId: "s1", orderItem: { id: "i1", sku: "001", name: "Stolica", qty: 2, product: { barcode: "860000001" } }, ...patch });
describe("warehouse picking plan", () => {
 it("contains every position exactly once in the PDF layout", () => {
  const cells = pickingLayout.flat(2);
  expect(cells).toHaveLength(240);
  expect([...cells].sort((a,b)=>a-b)).toEqual(Array.from({length:240},(_,i)=>i+1));
  expect(pickingLayout[0][0][0]).toBe(29);
  expect(pickingLayout[7][1][14]).toBe(149);
 });
 it("aggregates one walk while preserving allocations and warehouse separation", () => {
  const rows = buildPickingPlan([line(), line({id:"l2",orderId:"o2",orderNumber:"P2",lineGroupKey:"o2",quantity:3}), line({id:"l3",warehouseId:"mp",warehouseName:"MP"})], []);
  expect(rows).toHaveLength(2);
  expect(rows[0].quantity).toBe(5);
  expect(rows[0].allocations.map(a=>[a.orderNumber,a.quantity])).toEqual([["P1",2],["P2",3]]);
  expect(rows[1].quantity).toBe(2);
 });
 it("does not count a legacy multi-box item twice; uses actual parcel quantities when present", () => {
  expect(buildPickingPlan([line(),line({id:"l2"})],[])[0].quantity).toBe(2);
  expect(buildPickingPlan([line({packedQuantity:1}),line({id:"l2",packedQuantity:1})],[])[0].quantity).toBe(2);
 });
 it("ignores deferred parcels and customer returns", () => {
  expect(buildPickingPlan([line({deferredAt:new Date()}),line({purpose:"RECLAMATION_RETURN"})],[])).toEqual([]);
 });
 it("uses explicit SKU locations before supplier fallback and honors route priority", () => {
  const base={warehouseId:"dc",supplierIds:[],skus:["001"]};
  const rows=buildPickingPlan([line()],[{...base,number:3,routeOrder:20},{...base,number:20,routeOrder:1},{...base,number:7,routeOrder:0,skus:[],supplierIds:["s1"]}]);
  expect(rows[0].positions).toEqual([20,3]);
  expect(buildPickingPlan([line()],[{...base,number:7,routeOrder:7,skus:[],supplierIds:["s1"]}])[0].positions).toEqual([7]);
 });
 it("keeps replacement parts distinct and never scans the full article barcode", () => {
  const row=buildPickingPlan([line({purpose:"RECLAMATION_REPLACEMENT",reclamation:{resolution:"ZAMENA_DELA",resolutionNote:"Naslon"}})],[])[0];
  expect(row.sku).toBe("DEO ZA 001");expect(row.barcode).toBeNull();expect(row.quantity).toBe(1);
 });
 it("rejects over-picking and invalid corrections", () => {
  expect(validatePickingDelta(1,1,2)).toBe(2);
  expect(validatePickingDelta(2,-1,2)).toBe(1);
  expect(()=>validatePickingDelta(2,1,2)).toThrow();
  expect(()=>validatePickingDelta(0,-1,2)).toThrow();
  expect(()=>validatePickingDelta(0,0.5,2)).toThrow();
 });
});
