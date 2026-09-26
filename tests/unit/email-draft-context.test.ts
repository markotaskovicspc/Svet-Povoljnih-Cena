import {beforeEach,expect,it,vi} from 'vitest';
import {createHmac} from 'node:crypto';
const mocks=vi.hoisted(()=>({findMany:vi.fn()}));
vi.mock('@/lib/db',()=>({db:{order:{findMany:mocks.findMany}}}));
import {POST} from '@/app/api/integrations/email-drafts/route';
const secret='synthetic-email-secret'.repeat(3);
beforeEach(()=>{vi.stubEnv('SOCIAL_INTEGRATION_SECRET',secret);mocks.findMany.mockReset().mockResolvedValue([]);});
function request(value:object,signed=true){const body=JSON.stringify(value),time=String(Date.now());return new Request('https://example.test/api/integrations/email-drafts',{method:'POST',body,headers:signed?{'x-spc-timestamp':time,'x-spc-signature':createHmac('sha256',secret).update(`${time}.${body}`).digest('hex')}: {}});}
it('requires a signed worker request',async()=>{expect((await POST(request({sender:'buyer@example.com'},false))).status).toBe(401);expect(mocks.findMany).not.toHaveBeenCalled();});
it('scopes even an explicit order number to actual sender email and excludes private contact/token fields',async()=>{
 const response=await POST(request({sender:'buyer@example.com',number:'SPC-2026-001052'}));expect(response.status).toBe(200);
 const args=mocks.findMany.mock.calls[0][0];expect(args.where.number).toBe('SPC-2026-001052');expect(args.where.OR[0].guestEmail.equals).toBe('buyer@example.com');expect(args.select.shipStreet).toBeUndefined();expect(args.select.publicAccessTokenHash).toBeUndefined();expect(args.take).toBe(5);
});
