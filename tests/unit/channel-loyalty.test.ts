import { afterEach, beforeEach, expect, it, vi } from "vitest";

type Token = { token: string; identifier: string; expires: Date };
type Membership = { email: string; consentVersion: string; consentAt: Date };
const m = vi.hoisted(() => ({ records: new Map<string, Token>(), members: new Map<string, Membership>() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => {
  const tables = {
    verificationToken: {
      findUnique: async ({ where }: { where: { token: string } }) => m.records.get(where.token),
      upsert: async ({ where, create }: { where: { token: string }; create: Token }) => {
        if (!m.records.has(where.token)) m.records.set(where.token, create);
        return m.records.get(where.token);
      },
    },
    guestLoyaltyMembership: {
      findUnique: async ({ where }: { where: { email: string } }) => m.members.get(where.email),
      upsert: async ({ where, create, update }: { where: { email: string }; create: Membership; update: Partial<Membership> }) => {
        const existing = m.members.get(where.email);
        const value = existing ? { ...existing, ...update } : create;
        m.members.set(where.email, value);
        return value;
      },
    },
  };
  return { db: { ...tables, $transaction: async <T>(fn: (tx: typeof tables) => Promise<T>) => fn(tables) } };
});
import {prepareChannelLoyalty,acceptChannelLoyalty,channelLoyalty,existingChannelLoyalty} from '@/lib/loyalty/channel.server';
import {LOYALTY_CONSENT_VERSION} from '@/lib/loyalty/shared';
const secret='synthetic-loyalty-secret'.repeat(3),scope={channel:'facebook' as const,conversationId:'conversation-test',email:'buyer@example.com'};
beforeEach(()=>{m.records.clear();m.members.clear();vi.useRealTimers();});
afterEach(()=>vi.useRealTimers());
it.each(['facebook','instagram','email'] as const)('stops promising a first-purchase discount for %s at the October boundary',channel=>{
 vi.useFakeTimers();vi.setSystemTime(new Date('2026-09-30T21:59:59.999Z'));
 expect(prepareChannelLoyalty({...scope,channel},secret).summary).toContain('dodatnih 15%');
 vi.setSystemTime(new Date('2026-09-30T22:00:00Z'));
 const summary=prepareChannelLoyalty({...scope,channel},secret).summary;
 expect(summary).toContain('30%');
 expect(summary).not.toMatch(/10%|15%|prvu kupovinu/);
});
it('reuses existing consent without enrolling, and rejects wrong scope, revocation and expiry',async()=>{
 expect(await existingChannelLoyalty(scope,secret)).toEqual({ok:true,active:false});expect(m.members.size).toBe(0);
 m.members.set(scope.email,{email:scope.email,consentVersion:LOYALTY_CONSENT_VERSION,consentAt:new Date()});
 const before=m.members.get(scope.email),found=await existingChannelLoyalty(scope,secret);
 if(!found.active)throw Error('expected membership');
 expect(await channelLoyalty(found.proof,scope,secret)).toMatchObject({email:scope.email});
 expect(m.members.get(scope.email)).toBe(before);expect(m.records.size).toBe(0);
 expect(await channelLoyalty(found.proof,{...scope,conversationId:'other'},secret)).toBeNull();
 vi.useFakeTimers();vi.advanceTimersByTime(16*60000);expect(await channelLoyalty(found.proof,scope,secret)).toBeNull();vi.useRealTimers();
 m.members.clear();expect(await channelLoyalty(found.proof,scope,secret)).toBeNull();
});
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
