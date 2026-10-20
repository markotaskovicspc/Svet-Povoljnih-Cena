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
 expect(args).toMatchObject({orderBy:{id:'asc'},take:3});expect(args.select).toEqual({id:true,number:true,sku:true,quantity:true,createdAt:true});
 const next=parseExportQuery('reclamations',new URL('https://erp.test?from=2026-04-01&to=2026-04-01&limit=2&cursor='+q.nextCursor('last-id')),'secret');await exportReclamations(next);expect(mocks.list.mock.calls[1][0].where.id.gt).toBe('last-id');
});
it('cursor is bound to reclamations and the exact period',()=>{const q=parseExportQuery('reclamations',new URL('https://erp.test?from=2026-10-01&to=2026-10-21'),'secret');expect(()=>parseExportQuery('orders',new URL('https://erp.test?from=2026-10-01&to=2026-10-21&cursor='+q.nextCursor('id')),'secret')).toThrow()});
