import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(()=>({query:vi.fn(), users:vi.fn()}));
vi.mock('server-only',()=>({}));
vi.mock('@/lib/db',()=>({db:{$queryRaw:mocks.query,user:{findMany:mocks.users}}}));
import { resolveAudience, getViberContactSummary } from '@/lib/viber/audience';
beforeEach(()=>{vi.clearAllMocks();mocks.query.mockResolvedValue([]);mocks.users.mockResolvedValue([])});
it('normalizes and deduplicates phones while excluding invalid provider numbers',async()=>{
 mocks.users.mockResolvedValue([{id:'a',phone:'063 772 5045'},{id:'b',phone:'+381637725045'},{id:'c',phone:'invalid'}]);
 const rows=await resolveAudience({includeNonCustomers:true});
 expect(rows).toHaveLength(1);expect(rows[0].phone).toBe('381637725045');
 expect(mocks.users.mock.calls[0][0].where.marketingConsent).toEqual({is:{viber:true}});
});
it('returns contact inventory counts without returning private numbers',async()=>{
 mocks.query.mockResolvedValueOnce([{phone:'0637725045'},{phone:'+381637725045'},{phone:'0641234567'},{phone:'invalid'}]).mockResolvedValueOnce([]);
 mocks.users.mockResolvedValue([{id:'a',phone:'0637725045'}]);
 expect(await getViberContactSummary()).toEqual({total:2,eligible:1,allEligible:0,withoutConsent:1,invalid:1});
});

it('includes guest order/customer numbers under the dated declaration, deduplicates and honors withdrawals',async()=>{
 mocks.query.mockResolvedValueOnce([{phone:'0637725045',name:'Gost'},{phone:'+381637725045',name:'Duplikat'},{phone:'0641234567',name:'Odjavljen'}]).mockResolvedValueOnce([{phone:'+381641234567'}]);
 const rows=await resolveAudience({allStoredPhones:true});
 expect(rows).toHaveLength(1);expect(rows[0]).toMatchObject({phone:'381637725045',displayName:'Gost'});expect(rows[0].userId).toMatch(/^phone_[a-f0-9]{64}$/);
 expect(mocks.query.mock.calls[0][0].values).toContainEqual(new Date('2026-10-14T20:38:02.000Z'));
});

it('current scope includes recent guest customers and uses SMS withdrawals independently',async()=>{
 mocks.query.mockResolvedValueOnce([{phone:'0637725045',name:'Nov kupac'}]).mockResolvedValueOnce([]);
 const rows=await resolveAudience({allStoredPhones:true,phoneScope:'current',channel:'SMS'});
 expect(rows).toHaveLength(1);
 const cutoff=mocks.query.mock.calls[0][0].values.find((v:unknown)=>v instanceof Date);
 expect(cutoff.getTime()).toBeGreaterThan(new Date('2026-10-19').getTime());
 expect(mocks.query.mock.calls[1][0].sql).toContain('mc.sms');
 expect(mocks.query.mock.calls[1][0].sql).not.toContain('mc.viber');
});

it('resolves imported contacts separately and honors current withdrawals',async()=>{
 mocks.query.mockResolvedValue([{phone:'0641234567'}]);
 const rows=await resolveAudience({channel:'SMS',importedContacts:[{phone:'381637725045',name:'Marko'},{phone:'381641234567',name:'Odjavljen'},{phone:'381637725045',name:'Duplikat'}]});
 expect(rows).toHaveLength(1);expect(rows[0]).toMatchObject({phone:'381637725045',displayName:'Marko'});
 expect(mocks.query.mock.calls[0][0].sql).toContain('mc.sms');
});
it('unions Excel and existing contacts without sending duplicates',async()=>{
 mocks.query.mockResolvedValueOnce([]).mockResolvedValueOnce([{phone:'0637725045',name:'Kupac'}]).mockResolvedValueOnce([]);
 const rows=await resolveAudience({channel:'VIBER',allStoredPhones:true,phoneScope:'current',importedContacts:[{phone:'381637725045',name:'Marko'},{phone:'381641234567',name:'Ana'}]});
 expect(rows.map(r=>r.phone)).toEqual(['381637725045','381641234567']);
});
