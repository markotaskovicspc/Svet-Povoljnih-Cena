import { beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ pickupBatch: { findUnique: vi.fn() }, warehousePickingPosition: { findMany: vi.fn() }, pickingScanEvent: { findMany: vi.fn() }, adminUser: { findMany: vi.fn() } }));
vi.mock("@/lib/db", () => ({ db: mock }));
import { getPickingSession, getPickingBatchProgress } from "@/lib/admin/picking.server";
const item = { id: "i1", sku: "001", name: "Chair", qty: 10, warehouseId: "dc", warehouse: { name: "DC" }, product: { barcode: "8601", supplierId: "s1" } };
const packedItem = { orderItemId: "i1", quantity: 3, sku: "001", name: "Chair", barcode: "8601", categoryName: null, color1: null, color2: null, unitValue: 100 };
const line = { id: "l1", orderId: "o1", orderItemId: "i1", lineGroupKey: "o1", quantity: 10, packedQuantity: 3, packedItems: [packedItem], purpose: "ORDER_DELIVERY", deferredAt: null, reclamation: null, order: { id: "o1", number: "P1", status: "U_PRIPREMI", items: [item] } };
const batch = { id: "b1", number: "PRE1", status: "DRAFT", labelsCreationStartedAt: null, labelsCreatedAt: null, lines: [line] };
beforeEach(() => { vi.clearAllMocks(); mock.pickupBatch.findUnique.mockResolvedValue(structuredClone(batch)); mock.warehousePickingPosition.findMany.mockResolvedValue([]); mock.pickingScanEvent.findMany.mockResolvedValue([]); mock.adminUser.findMany.mockResolvedValue([]); });
it("collects only active parcel contents, not the entire original order quantity", async () => {
 const session = await getPickingSession("b1");
 expect(session.rows[0].quantity).toBe(3);
 expect(session.rows[0].allocations).toEqual([{orderId:"o1",orderNumber:"P1",quantity:3}]);
});
it("preserves progress for location edits but invalidates changed contents", async () => {
 const original = await getPickingSession("b1");
 mock.warehousePickingPosition.findMany.mockResolvedValue([{warehouseId:"dc",number:4,routeOrder:1,skus:["001"],supplierIds:[]}]);
 expect((await getPickingSession("b1")).planHash).toBe(original.planHash);
 mock.pickupBatch.findUnique.mockResolvedValue({...batch,lines:[{...line,packedItems:[{...packedItem,quantity:2}]}]});
 mock.pickingScanEvent.findMany.mockResolvedValue([{id:"e1",batchId:"b1",rowKey:original.rows[0].key,planHash:original.planHash,delta:2,note:"",actorId:"admin",createdAt:new Date()}]);
 const changed=await getPickingSession("b1");
 expect(changed.planHash).not.toBe(original.planHash);expect(changed.progress).toEqual({});expect(changed.previousPlan).toBe(true);
});
it("uses the replacement warehouse and preserves cancelled orders and scan progress", async () => {
 mock.pickupBatch.findUnique.mockResolvedValue({...batch,lines:[{...line,reclamation:{resolution:"ZAMENA_ARTIKLA",resolutionNote:null,warehouseId:"replacement",warehouse:{name:"Replacement DC"}}}]});
 expect((await getPickingSession("b1")).rows[0].warehouseName).toBe("Replacement DC");
 mock.pickupBatch.findUnique.mockResolvedValue(batch);
 const original = await getPickingSession("b1");
 mock.pickingScanEvent.findMany.mockResolvedValue([{id:"scan",batchId:"b1",rowKey:original.rows[0].key,planHash:original.planHash,delta:3,note:"",actorId:"admin",createdAt:new Date()}]);
 mock.pickupBatch.findUnique.mockResolvedValue({...batch,lines:[{...line,order:{...line.order,status:"OTKAZANO"}}]});
 const cancelled = await getPickingSession("b1");
 expect(cancelled.rows).toEqual(original.rows);
 expect(cancelled.planHash).toBe(original.planHash);
 expect(cancelled.progress[original.rows[0].key]).toBe(3);
 expect(cancelled.cancelledOrders).toEqual([{id:"o1",number:"P1"}]);
 expect(cancelled.labelsPreparationAllowed).toBe(false);
});
it("blocks labels using cancelledAt as well as status, without blocking replacement goods", async () => {
 mock.pickupBatch.findUnique.mockResolvedValue({...batch,lines:[{...line,order:{...line.order,cancelledAt:new Date()}}]});
 expect((await getPickingSession("b1")).labelsPreparationAllowed).toBe(false);
 mock.pickupBatch.findUnique.mockResolvedValue({...batch,lines:[{...line,purpose:"RECLAMATION_REPLACEMENT",order:{...line.order,status:"OTKAZANO",cancelledAt:new Date()}}]});
 const replacement = await getPickingSession("b1");
 expect(replacement.cancelledOrders).toEqual([]);
 expect(replacement.labelsPreparationAllowed).toBe(true);
 expect(replacement.rows).toHaveLength(1);
});

it("colors list cards from current parcel progress, including quantity corrections", async () => {
 const session = await getPickingSession("b1");
 const summary = () => getPickingBatchProgress([structuredClone(batch)] as never);
 const event = { batchId: "b1", rowKey: session.rows[0].key, planHash: session.planHash, delta: 1 };
 expect((await summary()).get("b1")).toEqual({ done: 0, total: 3, status: "empty" });
 mock.pickingScanEvent.findMany.mockResolvedValue([event]);
 expect((await summary()).get("b1")).toEqual({ done: 1, total: 3, status: "partial" });
 mock.pickingScanEvent.findMany.mockResolvedValue([{ ...event, delta: 3 }]);
 expect((await summary()).get("b1")).toEqual({ done: 3, total: 3, status: "complete" });
 mock.pickingScanEvent.findMany.mockResolvedValue([{ ...event, delta: 3 }, { ...event, delta: -1 }]);
 expect((await summary()).get("b1")).toEqual({ done: 2, total: 3, status: "partial" });
});
it("ignores old plans and counts all list cards with a single event query", async () => {
 const session = await getPickingSession("b1");
 mock.pickingScanEvent.findMany.mockClear();
 mock.pickingScanEvent.findMany.mockResolvedValue([{ batchId:"b1", rowKey:session.rows[0].key, planHash:session.planHash, delta:3 }]);
 const changed = { ...batch, lines: [{ ...line, packedItems: [{ ...packedItem, quantity: 2 }] }] };
 const summaries = await getPickingBatchProgress([changed, {...batch,id:"b2"}] as never);
 expect(summaries.get("b1")).toEqual({ done:0,total:2,status:"empty" });
 expect(summaries.get("b2")).toEqual({ done:0,total:3,status:"empty" });
 expect(mock.pickingScanEvent.findMany).toHaveBeenCalledTimes(1);
 expect(mock.pickingScanEvent.findMany).toHaveBeenCalledWith(expect.objectContaining({where:{batchId:{in:["b1","b2"]}}}));
});
it("keeps cancelled parcels in the picking card until manually removed", async () => {
 const cancelled = {...batch,lines:[{...line,order:{...line.order,status:"OTKAZANO"}}]};
 expect((await getPickingBatchProgress([cancelled] as never)).get("b1")).toEqual({done:0,total:3,status:"empty"});
});
