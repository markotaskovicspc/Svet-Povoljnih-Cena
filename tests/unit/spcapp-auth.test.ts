import { createHash } from 'node:crypto';
import { beforeEach, expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({client:vi.fn(),update:vi.fn(),limit:vi.fn()}));
vi.mock('@/lib/db',()=>({db:{partnerApiClient:{findUnique:mocks.client,update:mocks.update}}}));
vi.mock('@/lib/security/rate-limit',()=>({checkRateLimit:mocks.limit,rateLimitKey:()=> 'bucket'}));
import {authenticatePartner} from '@/lib/partners/auth';
const key='spcapp_test_long_enough_12345678901234567890';
const request=()=>new Request('https://erp.test',{headers:{Authorization:`Bearer ${key}`}});
beforeEach(()=>{vi.clearAllMocks();mocks.client.mockResolvedValue({id:'client',enabled:true,keyHash:createHash('sha256').update(key).digest('hex'),scopes:['spcapp:read'],rateLimit:120});mocks.limit.mockResolvedValue({ok:true});mocks.update.mockResolvedValue({});});
it('requires a bearer token and rejects malformed tokens before touching the DB',async()=>{
 expect(await authenticatePartner(new Request('https://erp.test'),'spcapp:read')).toMatchObject({ok:false,status:401});expect(mocks.client).not.toHaveBeenCalled();
});
it('authorizes the dedicated read scope but grants no inventory or write scope',async()=>{
 expect(await authenticatePartner(request(),'spcapp:read')).toMatchObject({ok:true});
 expect(await authenticatePartner(request(),'reservations:write')).toMatchObject({ok:false,status:403});
 expect(await authenticatePartner(request(),'inventory:read')).toMatchObject({ok:false,status:403});
});
it('does not grant financial access to an existing inventory key',async()=>{
 mocks.client.mockResolvedValue({id:'client',enabled:true,keyHash:createHash('sha256').update(key).digest('hex'),scopes:['inventory:read']});
 expect(await authenticatePartner(request(),'spcapp:read')).toMatchObject({ok:false,status:403});
 expect(mocks.limit).not.toHaveBeenCalled();
});
it('rejects disabled keys and wrong secrets even with a valid prefix',async()=>{
 mocks.client.mockResolvedValueOnce({enabled:false,keyHash:createHash('sha256').update(key).digest('hex')});
 expect(await authenticatePartner(request(),'spcapp:read')).toMatchObject({ok:false,status:401});
 mocks.client.mockResolvedValueOnce({enabled:true,keyHash:createHash('sha256').update('different-key').digest('hex')});
 expect(await authenticatePartner(request(),'spcapp:read')).toMatchObject({ok:false,status:401});
});
