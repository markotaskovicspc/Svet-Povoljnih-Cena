import {beforeEach,expect,it,vi} from 'vitest';
import {parseExportQuery} from '@/lib/partners/spcapp/contract';
import {shipmentExportReferences} from '@/lib/partners/spcapp/shipment-references';
const mocks=vi.hoisted(()=>({shipments:vi.fn(),orders:vi.fn()}));
vi.mock('@/lib/db',()=>({db:{shipment:{findMany:mocks.shipments},order:{findMany:mocks.orders}}}));
vi.mock('@/lib/admin/fiscal-cogs.server',()=>({loadFiscalCogs:vi.fn(),loadAnanasCostDates:vi.fn()}));
import {exportShipments} from '@/lib/partners/spcapp/logistics.server';
import {exportOrders} from '@/lib/partners/spcapp/sales.server';
const q=(resource:string)=>parseExportQuery(resource,new URL('https://erp.test?from=2026-10-01&to=2026-10-21'),'test-secret');
const shipment={id:'s1',provider:'X_EXPRESS',trackingNo:'AAA001',providerOrderId:'26-00001',providerParcelNumbers:['AAA001']};
beforeEach(()=>vi.clearAllMocks());
it('exports exact invoice code and parcel labels together with the existing order number',async()=>{
 mocks.shipments.mockResolvedValue([{...shipment,order:{number:'TEST-1',invoices:[],fiscalDocuments:[]}}]);
 const [row]=await exportShipments(q('shipments'));
 expect(row).toMatchObject({...shipment,orderNumber:'TEST-1'});
 const select=mocks.shipments.mock.calls[0][0].select;
 expect(select.providerOrderId).toBe(true);expect(select.providerParcelNumbers).toBe(true);
 for(const name of ['rawCreateResponse','providerPayload','labelUrl','recipient'])expect(select).not.toHaveProperty(name);
});
it('exports the same identifiers on nested order shipments with no provider payload',async()=>{
 mocks.orders.mockResolvedValue([{id:'o1',number:'TEST-1',channel:'WEB',customerId:null,userId:null,shipments:[shipment],fiscalDocuments:[],items:[]}]);
 const [row]=await exportOrders(q('orders'));
 expect(row.shipments[0]).toMatchObject(shipment);
 const select=mocks.orders.mock.calls[0][0].select.shipments.select;
 expect(select.providerOrderId).toBe(true);expect(select.providerParcelNumbers).toBe(true);
 expect(select).not.toHaveProperty('rawCreateResponse');
});
it('keeps identifiers exact, excludes malformed JSON and never treats GLS provider order id as invoice code',()=>{
 expect(shipmentExportReferences({...shipment,providerParcelNumbers:['000001',123,{private:'excluded'},null,1.2]})).toEqual({providerOrderId:'26-00001',providerParcelNumbers:['000001',123]});
 expect(shipmentExportReferences({...shipment,provider:'MYGLS'}).providerOrderId).toBeNull();
 expect(shipmentExportReferences({...shipment,provider:null}).providerOrderId).toBeNull();
});
it('exports the saved order delivery city without selecting other address or contact fields',async()=>{
 mocks.orders.mockResolvedValue([{id:'o1',number:'TEST-1',channel:'WEB',customerId:null,userId:null,shipCity:'Kragujevac',shipments:[],fiscalDocuments:[],items:[]}]);
 const query=q('orders');
 const [row]=await exportOrders(query);
 expect(row).toMatchObject({id:'o1',number:'TEST-1',deliveryCity:'Kragujevac',channel:'SPC'});
 expect(row).not.toHaveProperty('shipCity');
 const args=mocks.orders.mock.calls[0][0];
 expect(args.where).toEqual({id:{gt:query.after},createdAt:{gte:query.period.start,lt:query.period.endExclusive}});
 expect(args.take).toBe(query.limit+1);
 expect(args.select.shipCity).toBe(true);
 for(const key of ['shipStreet','shipHouseNumber','shipPhone','shipFirstName','shipLastName','shipPostalCode','billCity','customer','user'])expect(args.select).not.toHaveProperty(key);
});
