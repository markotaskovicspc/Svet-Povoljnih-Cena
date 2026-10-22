import { beforeEach, expect, it, vi } from 'vitest';
const m=vi.hoisted(()=>({find:vi.fn(),claim:vi.fn(),queue:vi.fn(),update:vi.fn(),resolve:vi.fn(),transaction:vi.fn()}));
vi.mock('@/lib/db',()=>({db:{viberCampaign:{findUnique:m.find},$transaction:m.transaction}}));
vi.mock('@/lib/viber/audience',async()=>{const actual=await vi.importActual<typeof import('@/lib/viber/audience')>('@/lib/viber/audience');return {...actual,resolveAudience:m.resolve};});
vi.mock('@/lib/viber/config',()=>({getViberConfig:()=>({provider:'nth',deliveryMode:'worker',sender:'SPC'}),isViberReady:()=>true,isSmsReady:()=>true,smsSender:()=> 'SvetPovCena'}));
import {sendCampaign} from '@/lib/viber/campaign';
beforeEach(()=>{
 vi.clearAllMocks();
 m.find.mockResolvedValue({id:'c1',status:'DRAFT',body:'Test SMS',audience:{filter:{channel:'SMS',allStoredPhones:true,phoneScope:'current'}}});
 m.resolve.mockResolvedValue(Array.from({length:1001},(_,i)=>({phone:'381637725045',userId:'guest'+i,displayName:'Gost'})));
 m.claim.mockResolvedValue({count:1});m.queue.mockResolvedValue({count:250});m.update.mockResolvedValue({});
 m.transaction.mockImplementation((fn: (tx: { viberCampaign: { updateMany: typeof m.claim; update: typeof m.update }; backgroundJob: { createMany: typeof m.queue } }) => unknown)=>fn({viberCampaign:{updateMany:m.claim,update:m.update},backgroundJob:{createMany:m.queue}}));
});
it('atomically queues the full SMS audience in database batches, without an hourly recipient cap',async()=>{
 const report=await sendCampaign('c1');expect(report).toMatchObject({recipients:1001,delivered:1001,failed:0,status:'SENT'});
 expect(m.queue.mock.calls.map(c=>c[0].data.length)).toEqual([250,250,250,250,1]);
 const jobs=m.queue.mock.calls.flatMap(c=>c[0].data);expect(jobs.every(j=>j.payload.channels[0]==='SMS')).toBe(true);expect(new Set(jobs.map(j=>j.idempotencyKey)).size).toBe(1001);
 expect(m.update.mock.calls[0][0].data.recipients).toBe(1001);
});
it('a concurrent launch cannot enqueue any messages after losing the campaign claim',async()=>{
 m.claim.mockResolvedValue({count:0});await expect(sendCampaign('c1')).rejects.toThrow('već pokrenuta');expect(m.queue).not.toHaveBeenCalled();
});
it('does not enqueue a second time when a completed launch is retried',async()=>{
 m.find.mockResolvedValue({id:'c1',status:'SENT',recipients:1001,delivered:1001,failed:0});expect((await sendCampaign('c1')).delivered).toBe(1001);expect(m.transaction).not.toHaveBeenCalled();
});
