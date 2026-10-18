import { beforeEach, expect, it, vi } from 'vitest';
import { parseExportQuery } from '@/lib/partners/spcapp/contract';
const mocks = vi.hoisted(() => ({ docs:vi.fn(), ananas:vi.fn(), orders:vi.fn(), cost:vi.fn(), dates:vi.fn() }));
vi.mock('@/lib/db',()=>({db:{fiscalDocument:{findMany:mocks.docs},ananasDocument:{findMany:mocks.ananas},ananasOrder:{findMany:mocks.orders}}}));
vi.mock('@/lib/admin/fiscal-cogs.server',()=>({loadFiscalCogs:async()=>mocks.cost,loadAnanasCostDates:mocks.dates}));
import { exportFiscal, exportAnanasFiscal, exportAnanasOrders } from '@/lib/partners/spcapp/sales.server';
const q=(resource:string)=>parseExportQuery(resource,new URL('https://erp.test?from=2026-10-01&to=2026-10-18'),'secret');
beforeEach(()=>{vi.clearAllMocks();mocks.cost.mockReturnValue({unitCogs:100,estimated:true});mocks.dates.mockResolvedValue(new Map());});
it('exports signed partial refunds and allocated assembly separately, retaining the original cost date',async()=>{
 const originalDate=new Date('2026-09-01T12:00:00Z');
 mocks.docs.mockResolvedValue([{id:'refund',kind:'REFUND',receiptNumber:'R-1',issuedAt:new Date('2026-10-05'),totalGross:1600,totalNet:1333.33,totalVat:266.67,
  order:{id:'order',number:'SPC-1',channel:'WEB',customerId:'customer',userId:null,firstPurchaseDiscount:150},
  lines:[{id:'goods',sku:'STO',shortName:'Sto',qty:1,refundedQty:0,totalGross:1200,totalNet:1000,serviceGross:240,vatRate:20,unitCogs:null,originalSaleLine:{id:'original-line',unitCogs:100,fiscalDocument:{id:'sale',receiptNumber:'S-1',issuedAt:originalDate}}},
  {id:'shipping',sku:'DOSTAVA',shortName:'Dostava',qty:1,refundedQty:0,totalGross:400,totalNet:333.33,serviceGross:400,vatRate:20,unitCogs:null,originalSaleLine:null}]}]);
 const [row]=await exportFiscal(q('fiscal-documents'));
 expect(row).toMatchObject({gross:'-1600.00',totalCogsNet:'-100.00',firstPurchaseDiscountAllocatedGross:null,orderFirstPurchaseDiscountGross:'150.00',multipleMerchandiseUnits:false});
 expect(row.lines[0]).toMatchObject({quantity:1,signedQuantity:-1,merchandiseGross:'-960.00',assemblyGross:'-240.00',valuationAt:originalDate});
 expect(row.lines[1]).toMatchObject({merchandiseGross:'0.00',shippingGross:'-400.00',unitCogsNet:null});
 expect(mocks.cost).toHaveBeenCalledWith('STO',originalDate,100);
 const selection=mocks.docs.mock.calls[0][0].select;
 expect(selection).not.toHaveProperty('rawRequest');expect(selection.order.select).not.toHaveProperty('guestEmail');
});
it('keeps incomplete COGS totals unknown rather than presenting a partial sum as complete',async()=>{
 mocks.cost.mockReturnValue({unitCogs:null,estimated:false});
 mocks.ananas.mockResolvedValue([{id:'ana',kind:'SALE',fiscalNumber:'ANA-1',reference:null,orderNumber:'order',issuedAt:new Date('2026-10-05'),gross:1000,net:833.33,vat:166.67,items:[{sku:'X',name:'Sto',quantity:2,gross:1000}]}]);
 const [row]=await exportAnanasFiscal(q('ananas-fiscal-documents'));
 expect(row).toMatchObject({totalCogsNet:null,knownCogsSubtotalNet:'0.00',missingCogsQuantity:2,multipleMerchandiseUnits:true});
 expect(row.lines[0].net).toBeNull();
});
it('never leaks unrecognized Ananas JSON properties or pretends missing net/identity data is known',async()=>{
 mocks.orders.mockResolvedValue([{id:'ana-order',items:[{id:'i',sku:'X',name:'Sto',quantity:1,unitPrice:100,gross:100,net:null,shipping:0,shippingNet:null,commission:null,email:'private@example.test'}],shipments:[{suborderId:'s',status:'DELIVERED',carrierName:'Courier',address:'private'}]}]);
 mocks.ananas.mockResolvedValue([]);
 const [row]=await exportAnanasOrders(q('ananas-orders'));
 expect(JSON.stringify(row)).not.toContain('private');expect(row.customerKey).toBeNull();expect(row.items[0].net).toBeNull();expect(row.shippingNet).toBeNull();
});
