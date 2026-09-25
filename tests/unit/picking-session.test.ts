import { beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ pickupBatch: { findUnique: vi.fn() }, warehousePickingPosition: { findMany: vi.fn() }, pickingScanEvent: { findMany: vi.fn() }, adminUser: { findMany: vi.fn() } }));
vi.mock("@/lib/db", () => ({ db: mock }));
import { getPickingSession } from "@/lib/admin/picking.server";
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
it("uses the replacement warehouse and omits cancelled orders", async () => {
 mock.pickupBatch.findUnique.mockResolvedValue({...batch,lines:[{...line,reclamation:{resolution:"ZAMENA_ARTIKLA",resolutionNote:null,warehouseId:"replacement",warehouse:{name:"Replacement DC"}}}]});
 expect((await getPickingSession("b1")).rows[0].warehouseName).toBe("Replacement DC");
 mock.pickupBatch.findUnique.mockResolvedValue({...batch,lines:[{...line,order:{...line.order,status:"OTKAZANO"}}]});
 expect((await getPickingSession("b1")).rows).toEqual([]);
});
