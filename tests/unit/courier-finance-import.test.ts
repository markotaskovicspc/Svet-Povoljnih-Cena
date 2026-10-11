import { beforeEach, expect, it, vi } from "vitest";
const tx=vi.hoisted(()=>({ $queryRaw: vi.fn(), courierStatement: {findFirst:vi.fn(),create:vi.fn()},courierStatementLine:{createMany:vi.fn(),findUniqueOrThrow:vi.fn(),update:vi.fn()},shipment:{findMany:vi.fn()},order:{updateMany:vi.fn()} }));
vi.mock("@/lib/db",()=>({db:{$transaction:async(fn:(t:unknown)=>unknown)=>fn(tx)}}));
import { importStatement, statementIdentity, linkStatementLine } from "@/lib/courier/finance.server";
const input={provider:"MYGLS" as const,documentNo:"TEST",filename:"test.csv",rows:[{kind:"COD" as const,trackingNo:"900001",orderNumber:"SPC-1",bookedOn:"2026-10-09",amount:600,vatIncluded:true}]};
beforeEach(()=>{vi.resetAllMocks();tx.courierStatement.create.mockResolvedValue({id:"doc"});tx.courierStatement.findFirst.mockResolvedValue(null);tx.shipment.findMany.mockResolvedValueOnce([{id:"s1",trackingNo:"900001",providerParcelNumbers:null,orderId:"o1",order:{number:"SPC-1"}}]);});
it("does not confirm a partially remitted order",async()=>{
 tx.shipment.findMany.mockResolvedValueOnce([{codAmount:1000,status:"DELIVERED",purpose:"ORDER_DELIVERY",courierStatementLines:[{amountGross:600,bookedOn:new Date("2026-10-09")}]}]);
 await importStatement(input,statementIdentity(input).fingerprint,"actor"); expect(tx.order.updateMany).not.toHaveBeenCalled();
});
it("confirms only the exact sum across all active shipment groups",async()=>{
 tx.shipment.findMany.mockResolvedValueOnce([{codAmount:600,status:"DELIVERED",purpose:"ORDER_DELIVERY",courierStatementLines:[{amountGross:600,bookedOn:new Date("2026-10-09")}]},{codAmount:400,status:"DELIVERED",purpose:"ORDER_DELIVERY",courierStatementLines:[{amountGross:400,bookedOn:new Date("2026-10-10")}]}]);
 await importStatement(input,statementIdentity(input).fingerprint,"actor");expect(tx.order.updateMany).toHaveBeenCalledWith({where:{id:"o1",courierPaidAt:null},data:{courierPaidAt:new Date("2026-10-10")}});
});
it("preserves an unknown expected amount instead of treating it as paid",async()=>{
 tx.shipment.findMany.mockResolvedValueOnce([{codAmount:null,rawCreateResponse:null,status:"DELIVERED",purpose:"ORDER_DELIVERY",courierStatementLines:[{amountGross:600,bookedOn:new Date("2026-10-09")}]}]);
 await importStatement(input,statementIdentity(input).fingerprint,"actor");expect(tx.order.updateMany).not.toHaveBeenCalled();
});
it("makes a duplicate import a no-op and rejects altered content under the same number",async()=>{
 const fingerprint=statementIdentity(input).fingerprint;tx.courierStatement.findFirst.mockResolvedValue({id:"doc",fingerprint});
 expect((await importStatement(input,fingerprint,"actor")).alreadyImported).toBe(true);expect(tx.courierStatementLine.createMany).not.toHaveBeenCalled();
 tx.courierStatement.findFirst.mockResolvedValue({id:"doc",fingerprint:"other"});await expect(importStatement(input,fingerprint,"actor")).rejects.toThrow(/drugačijim/);
});
it("does not relink an already assigned statement line",async()=>{
 tx.courierStatementLine.findUniqueOrThrow.mockResolvedValue({shipmentId:"s1"});await expect(linkStatementLine("line","900001")).rejects.toThrow(/već povezana/);expect(tx.courierStatementLine.update).not.toHaveBeenCalled();
});
