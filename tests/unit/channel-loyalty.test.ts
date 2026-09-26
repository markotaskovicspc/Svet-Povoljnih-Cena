import {beforeEach,expect,it,vi} from 'vitest';
const m=vi.hoisted(()=>({records:new Map(),members:new Map()}));
vi.mock('server-only',()=>({}));
vi.mock('@/lib/db',()=>{
 const db={verificationToken:{findUnique:async({where}:any)=>m.records.get(where.token),upsert:async({where,create}:any)=>{if(!m.records.has(where.token))m.records.set(where.token,create);return m.records.get(where.token);}},guestLoyaltyMembership:{findUnique:async({where}:any)=>m.members.get(where.email),upsert:async({where,create,update}:any)=>{const value=m.members.has(where.email)?{...m.members.get(where.email),...update}:create;m.members.set(where.email,value);return value;}},$transaction:async(fn:any)=>fn(db)};
 return {db};
});
import {prepareChannelLoyalty,acceptChannelLoyalty,channelLoyalty} from '@/lib/loyalty/channel.server';
const secret='synthetic-loyalty-secret'.repeat(3),scope={channel:'facebook' as const,conversationId:'conversation-test',email:'buyer@example.com'};
beforeEach(()=>{m.records.clear();m.members.clear();vi.useRealTimers();});
it('requires explicit acceptance, binds proof to conversation/email/channel and persists a stable retry',async()=>{
 const prepared=prepareChannelLoyalty(scope,secret);
 expect(m.members.size).toBe(0);
 expect(await channelLoyalty(prepared.challenge,scope,secret)).toBeNull();
 const accepted=await acceptChannelLoyalty(prepared.challenge,scope,secret);
 expect(accepted).toBeTruthy();
 expect(await acceptChannelLoyalty(prepared.challenge,scope,secret)).toEqual(accepted);
 expect(m.members.size).toBe(1);
 expect(await channelLoyalty(accepted!.proof,scope,secret)).toMatchObject({email:scope.email});
 for(const change of [{email:'other@example.com'},{conversationId:'other-chat'},{channel:'instagram' as const}])expect(await channelLoyalty(accepted!.proof,{...scope,...change},secret)).toBeNull();
 expect(await acceptChannelLoyalty(prepared.challenge,{...scope,email:'other@example.com'},secret)).toBeNull();
 m.members.clear();expect(await channelLoyalty(accepted!.proof,scope,secret)).toBeNull();
});
it('expired invitation cannot start a membership; expired access cannot price an order',async()=>{
 vi.useFakeTimers();const prepared=prepareChannelLoyalty(scope,secret);
 vi.advanceTimersByTime(25*3600000);expect(await acceptChannelLoyalty(prepared.challenge,scope,secret)).toBeNull();
 const current=prepareChannelLoyalty(scope,secret),accepted=await acceptChannelLoyalty(current.challenge,scope,secret);
 vi.advanceTimersByTime(31*24*3600000);expect(await channelLoyalty(accepted!.proof,scope,secret)).toBeNull();
});
