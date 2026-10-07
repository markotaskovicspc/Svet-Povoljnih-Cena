import {beforeEach,afterEach,it,expect,vi} from 'vitest';
const mocks=vi.hoisted(()=>({auth:vi.fn(),audit:vi.fn()}));
vi.mock('@/lib/admin',()=>({requireAdminAction:mocks.auth}));
vi.mock('@/lib/admin/audit',()=>({logAudit:mocks.audit}));
import {actOnConversation} from '@/app/admin/razgovori/actions';
beforeEach(()=>{mocks.auth.mockResolvedValue({id:'operator'});mocks.audit.mockResolvedValue({id:'audit'});vi.stubEnv('SOCIAL_INTEGRATION_SECRET','private-integration-key');});
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
it('requires ERP operator login before any backend mutation',async()=>{
 const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);mocks.auth.mockRejectedValueOnce(new Error('Login required'));
 await expect(actOnConversation({id:'web:spc:test',action:'pause'})).rejects.toThrow('Login required');expect(fetcher).not.toHaveBeenCalled();expect(mocks.auth).toHaveBeenCalledWith(['OPS']);
});
it('audits and binds authenticated actor server-side; never returns credential',async()=>{
 const fetcher=vi.fn().mockResolvedValue({ok:true,json:async()=>({ok:true})});vi.stubGlobal('fetch',fetcher);
 const result=await actOnConversation({id:'web:spc:test',action:'reply',text:'Reply',requestId:'11111111-1111-4111-8111-111111111111'});
 expect(result.ok).toBe(true);expect(JSON.stringify(result)).not.toContain('private-integration-key');
 expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({actorId:'operator',entityId:'web:spc:test'}));
 const [,options]=fetcher.mock.calls[0];expect(JSON.parse(options.body).actorId).toBe('operator');expect(options.headers.authorization).toBe('Bearer private-integration-key');
});
it('keeps same delivery attempt after timeout and sends nothing if audit fails',async()=>{
 const fetcher=vi.fn().mockRejectedValue(new Error('secret raw error'));vi.stubGlobal('fetch',fetcher);
 const result=await actOnConversation({id:'web:spc:test',action:'pause'});expect(result.retrySame).toBe(true);expect(result.message).not.toContain('secret');
 mocks.audit.mockRejectedValueOnce(new Error('audit unavailable'));fetcher.mockClear();await actOnConversation({id:'web:spc:test',action:'pause'});expect(fetcher).not.toHaveBeenCalled();
});
