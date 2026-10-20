import {beforeEach,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({list:vi.fn()}));
vi.mock('@/lib/db',()=>({db:{reclamation:{findMany:mocks.list}}}));
import {parseExportQuery} from '@/lib/partners/spcapp/contract';
import {exportReclamations} from '@/lib/partners/spcapp/reclamations.server';
beforeEach(()=>{vi.clearAllMocks();mocks.list.mockResolvedValue([])});
it('exports all statuses by Belgrade registration day with a bounded ID cursor and no customer/payment fields',async()=>{
 const q=parseExportQuery('reclamations',new URL('https://erp.test?from=2026-04-01&to=2026-04-01&limit=2'),'secret');
 await exportReclamations(q);const args=mocks.list.mock.calls[0][0];
 expect(args.where).toEqual({id:{gt:''},createdAt:{gte:new Date('2026-03-31T22:00:00Z'),lt:new Date('2026-04-01T22:00:00Z')}});
 expect(args).toMatchObject({orderBy:{id:'asc'},take:3});expect(args.select).toEqual({id:true,number:true,sku:true,quantity:true,createdAt:true,status:true});
 const next=parseExportQuery('reclamations',new URL('https://erp.test?from=2026-04-01&to=2026-04-01&limit=2&cursor='+q.nextCursor('last-id')),'secret');await exportReclamations(next);expect(mocks.list.mock.calls[1][0].where.id.gt).toBe('last-id');
});
it('cursor is bound to reclamations and the exact period',()=>{const q=parseExportQuery('reclamations',new URL('https://erp.test?from=2026-10-01&to=2026-10-21'),'secret');expect(()=>parseExportQuery('orders',new URL('https://erp.test?from=2026-10-01&to=2026-10-21&cursor='+q.nextCursor('id')),'secret')).toThrow()});

it('exports complete registration history with status and binds the cursor to all-history mode',async()=>{
 const q=parseExportQuery('reclamations',new URL('https://erp.test?history=all'),'secret');await exportReclamations(q);expect(mocks.list.mock.calls[0][0].where).toEqual({id:{gt:''}});expect(mocks.list.mock.calls[0][0].select.status).toBe(true);
 expect(()=>parseExportQuery('reclamations',new URL('https://erp.test?cursor='+q.nextCursor('id')),'secret')).toThrow();expect(()=>parseExportQuery('orders',new URL('https://erp.test?history=all'),'secret')).toThrow();
});

it('preserves existing signed cursor bindings for all ordinary period exports',()=>{const q=parseExportQuery('orders',new URL('https://erp.test?from=2026-01-01&to=2026-10-21'),'secret');const decoded=JSON.parse(Buffer.from(q.nextCursor('id').split('.')[0],'base64url').toString());expect(decoded.binding).toBe(JSON.stringify(['orders','2026-01-01','2026-10-21','day','orders',null,null]));});

it('includes only customer name in full-history journal and excludes it from matrix period exports',async()=>{
 await exportReclamations(parseExportQuery('reclamations',new URL('https://erp.test?history=all'),'secret'));
 const selection=mocks.list.mock.calls[0][0].select;expect(selection.customerFirst).toBe(true);expect(selection.customerLast).toBe(true);expect(selection).not.toHaveProperty('customerEmail');expect(selection).not.toHaveProperty('customerPhone');expect(selection).not.toHaveProperty('customerAddress');
 await exportReclamations(parseExportQuery('reclamations',new URL('https://erp.test?from=2026-01-01&to=2026-10-21'),'secret'));expect(mocks.list.mock.calls[1][0].select).not.toHaveProperty('customerFirst');
});

it('SPC matrix claims explicitly exclude ANANAS orders without restricting the complete journal',async()=>{await exportReclamations(parseExportQuery('spc-reclamations',new URL('https://test?from=2026-01-01&to=2026-10-21'),'secret'));expect(mocks.list.mock.calls[0][0].where.order).toEqual({channel:{not:'ANANAS'}});expect(mocks.list.mock.calls[0][0].select).not.toHaveProperty('customerFirst');await exportReclamations(parseExportQuery('reclamations',new URL('https://test?history=all'),'secret'));expect(mocks.list.mock.calls[1][0].where).not.toHaveProperty('order')});
