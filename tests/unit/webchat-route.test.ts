import {beforeEach,expect,it,vi} from 'vitest';
import {NextRequest} from 'next/server';
const m=vi.hoisted(()=>({limit:vi.fn()}));
vi.mock('@/lib/security/rate-limit',()=>({checkRateLimitForRequest:m.limit,rateLimitJson:()=>new Response(null,{status:429})}));
import {GET,POST} from '../../src/app/api/chat/route';
beforeEach(()=>{vi.restoreAllMocks();process.env.SOCIAL_INTEGRATION_SECRET='synthetic-website-secret';m.limit.mockResolvedValue({ok:true});});
it('rejects cross-origin requests and uninitialized POST sessions before forwarding',async()=>{
 const f=vi.spyOn(globalThis,'fetch');
 expect((await GET(new NextRequest('https://shop.test/api/chat',{headers:{origin:'https://other.test'}}))).status).toBe(403);
 expect((await POST(new NextRequest('https://shop.test/api/chat',{method:'POST',body:'{}'}))).status).toBe(409);expect(f).not.toHaveBeenCalled();
});
it('sets a signed HttpOnly cookie and never exposes server credential to the visitor',async()=>{
 const f=vi.spyOn(globalThis,'fetch').mockImplementation(async()=>new Response(JSON.stringify({messages:[],needsSupport:false}),{status:200}));
 const r=await GET(new NextRequest('https://shop.test/api/chat'));
 expect(r.headers.get('set-cookie')).toContain('HttpOnly');expect(r.headers.get('set-cookie')).toContain('SameSite=lax');expect(await r.text()).not.toContain('synthetic-website-secret');
 expect(f.mock.calls[0][0].toString()).toMatch(/session=[0-9a-f-]+$/);
 const cookie=r.headers.get('set-cookie')!.split(';')[0];
 const id='22222222-2222-4222-8222-222222222222';
 const sent=await POST(new NextRequest('https://shop.test/api/chat',{method:'POST',headers:{cookie,origin:'https://shop.test'},body:JSON.stringify({id,text:'Hi',session:'OTHER',echo:true})}));
 expect(sent.status).toBe(200);expect(f.mock.calls[1][0].toString()).toBe(f.mock.calls[0][0].toString());expect(f.mock.calls[1][1]?.body).toBe(JSON.stringify({id,text:'Hi'}));
});
it('forged session cookies cannot select somebody else’s conversation',async()=>{
 const f=vi.spyOn(globalThis,'fetch');const cookie='spc_webchat=11111111-1111-4111-8111-111111111111.'+'a'.repeat(64);
 expect((await POST(new NextRequest('https://shop.test/api/chat',{method:'POST',headers:{cookie},body:'{}'}))).status).toBe(409);expect(f).not.toHaveBeenCalled();
});
