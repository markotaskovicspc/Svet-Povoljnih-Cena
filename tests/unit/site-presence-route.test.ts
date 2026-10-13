import { beforeEach, expect, it, vi } from 'vitest';
const m=vi.hoisted(()=>({upsert:vi.fn(),after:vi.fn(),limit:vi.fn(),evaluate:vi.fn()}));
vi.mock('@/lib/db',()=>({db:{siteVisitorPresence:{upsert:m.upsert}}}));
vi.mock('@/lib/admin/traffic-push.server',()=>({evaluateTrafficAlert:m.evaluate}));
vi.mock('@/lib/security/rate-limit',()=>({checkRateLimitForRequest:m.limit,rateLimitJson:()=>new Response(null,{status:429})}));
vi.mock('next/server',async(importOriginal)=>({...await importOriginal<typeof import('next/server')>(),after:m.after}));
import { POST } from '@/app/api/analytics/presence/route';
const identity='v2:11111111-1111-4111-8111-111111111111';
const req=(cookie='spc_cookie_consent=analytics',origin='https://shop.example',anonymousId=identity)=>new Request('https://shop.example/api/analytics/presence',{method:'POST',headers:{origin,cookie,'Content-Type':'application/json'},body:JSON.stringify({anonymousId})});
beforeEach(()=>{vi.resetAllMocks();m.limit.mockResolvedValue({ok:true});});
it('does not record presence before analytics consent or from another origin',async()=>{
 for(const cookie of ['', 'spc_cookie_consent=essential','spc_cookie_consent=marketing'])expect((await POST(req(cookie))).status).toBe(403);
 expect((await POST(req('spc_cookie_consent=all','https://attacker.example'))).status).toBe(403);
 expect(m.upsert).not.toHaveBeenCalled();expect(m.after).not.toHaveBeenCalled();
});
it('updates one visitor row across multiple tabs and runs evaluation after the response',async()=>{
 await POST(req());await POST(req());expect(m.upsert).toHaveBeenCalledTimes(2);
 expect(m.upsert.mock.calls[0][0].where).toEqual({anonymousId:identity});
 expect(m.upsert.mock.calls[1][0].where).toEqual({anonymousId:identity});
 expect(m.evaluate).not.toHaveBeenCalled();await m.after.mock.calls[0][0]();expect(m.evaluate).toHaveBeenCalledOnce();
});
it('validates identities and applies the request rate limit',async()=>{
 expect((await POST(req('spc_cookie_consent=all','https://shop.example','invalid'))).status).toBe(400);
 m.limit.mockResolvedValue({ok:false});expect((await POST(req())).status).toBe(429);expect(m.upsert).not.toHaveBeenCalled();
});
