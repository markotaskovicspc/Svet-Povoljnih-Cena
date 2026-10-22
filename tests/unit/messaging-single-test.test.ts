import { beforeEach, expect, it, vi } from 'vitest';
const m=vi.hoisted(()=>({dispatch:vi.fn(),campaign:vi.fn(),count:vi.fn(),send:vi.fn()}));
vi.mock('@/lib/admin',()=>({requireAdminAction:vi.fn(),withAdminState:(_meta:unknown,fn:(actorId:string, form:FormData)=>unknown)=>(form:FormData)=>fn('admin-test',form)}));
vi.mock('@/lib/db',()=>({db:{viberCampaign:{findUniqueOrThrow:m.campaign}}}));
vi.mock('@/lib/viber/transport',()=>({dispatch:m.dispatch}));
vi.mock('@/lib/viber/config',()=>({isViberReady:()=>true,isSmsReady:()=>true}));
vi.mock('@/lib/viber/audience',()=>({STORED_PHONES_CONSENT:{},parseAudienceFilter:(v:unknown)=>v,countAudience:m.count}));
vi.mock('@/lib/viber/campaign',()=>({campaignDraftSchema:{},sendCampaign:m.send}));
vi.mock('next/cache',()=>({revalidatePath:vi.fn()}));
import { testViberMessage } from '@/app/admin/viber/actions';
import { EMPTY_ADMIN_ACTION_STATE } from '@/lib/admin/action-state';
beforeEach(()=>{vi.clearAllMocks();m.dispatch.mockResolvedValue({ok:true,provider:'nth',messageToken:'queued:test'});});
function form(channel:string,body='Test tekst') {const f=new FormData();f.set('channel',channel);f.set('body',body);f.set('phone','0637725045');return f;}
it.each(['SMS','VIBER'])('sends current %s composer text only to one supplied phone without saving or launching a campaign',async(channel)=>{
 const result=await testViberMessage(EMPTY_ADMIN_ACTION_STATE,form(channel));
 expect(result.ok).toBe(true);expect(m.dispatch).toHaveBeenCalledTimes(1);
 expect(m.dispatch.mock.calls[0][0]).toMatchObject({channel,to:'0637725045',text:'Test tekst'});
 expect(m.dispatch.mock.calls[0][0]).not.toHaveProperty('trackingData');
 expect(m.campaign).not.toHaveBeenCalled();expect(m.count).not.toHaveBeenCalled();expect(m.send).not.toHaveBeenCalled();
});
it('keeps invalid/empty content out of the outbound queue',async()=>{
 expect((await testViberMessage(EMPTY_ADMIN_ACTION_STATE,form('SMS',' '))).ok).toBe(false);
 expect((await testViberMessage(EMPTY_ADMIN_ACTION_STATE,form('VIBER','x'.repeat(1001)))).ok).toBe(false);
 const f=form('SMS');f.set('imageUrl','https://example.com/image.png');
 expect((await testViberMessage(EMPTY_ADMIN_ACTION_STATE,f)).ok).toBe(false);expect(m.dispatch).not.toHaveBeenCalled();
});
it('keeps old saved-draft test requests compatible and channel checked',async()=>{
 const f=new FormData();f.set('channel','SMS');f.set('id','saved');f.set('phone','0637725045');
 m.campaign.mockResolvedValue({body:'Sačuvan tekst',audience:{filter:{channel:'SMS'}}});
 expect((await testViberMessage(EMPTY_ADMIN_ACTION_STATE,f)).ok).toBe(true);
 expect(m.dispatch.mock.calls[0][0].text).toBe('Sačuvan tekst');
 m.campaign.mockResolvedValue({body:'Viber tekst',audience:{filter:{}}});
 await expect(testViberMessage(EMPTY_ADMIN_ACTION_STATE,f)).rejects.toThrow('drugom kanalu');
});
