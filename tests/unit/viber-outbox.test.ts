import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ blocked: vi.fn(), candidates: vi.fn(), update: vi.fn(), user: vi.fn(), campaign: vi.fn() }));
vi.mock("@/lib/viber/config", () => ({ isViberReady: () => true, isSmsReady: () => true }));
vi.mock("@/lib/db", () => ({ db: {
  $queryRaw: mocks.blocked,
  backgroundJob: { findMany: mocks.candidates, updateMany: mocks.update },
  user: { findFirst: mocks.user }, viberCampaign: { findUnique: mocks.campaign },
} }));
import { storedPhoneRecipientId } from "@/lib/viber/audience";
import { claimNthMessage } from "@/lib/viber/outbox";
afterEach(() => vi.resetAllMocks());
it("cancels queued marketing when consent was withdrawn or the campaign was deleted", async () => {
  mocks.candidates.mockResolvedValue([{ id: "one", status: "VIBER_QUEUED", lockedAt: null, payload: { transactionId: "cmp:c1:rcp:u1" } }]);
  mocks.user.mockResolvedValue(null);
  mocks.campaign.mockResolvedValue({ status: "SENT" });
  mocks.update.mockResolvedValue({ count: 1 });
  expect(await claimNthMessage()).toBeNull();
  expect(mocks.update.mock.calls[0][0].data.status).toBe("VIBER_CANCELLED");
});
it("does not return a job that another worker claimed concurrently", async () => {
  mocks.candidates.mockResolvedValue([
    { id: "one", status: "VIBER_QUEUED", lockedAt: null, payload: {} },
    { id: "two", status: "VIBER_QUEUED", lockedAt: null, payload: {} },
  ]);
  mocks.update.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 1 });
  expect(await claimNthMessage()).toEqual({ id: "two", payload: {} });
  expect(mocks.update.mock.calls[0][0].where).toMatchObject({ id: "one", status: "VIBER_QUEUED", lockedAt: null });
});

it('accepts a guest number only for a declared all-phone campaign and rechecks withdrawals', async()=>{
 const phone='381637725045';
 mocks.candidates.mockResolvedValue([{id:'guest',status:'VIBER_QUEUED',lockedAt:null,payload:{transactionId:`cmp:c1:rcp:${storedPhoneRecipientId(phone)}`,destinations:[{phoneNumber:phone}]}}]);
 mocks.campaign.mockResolvedValue({status:'SENT',audience:{filter:{allStoredPhones:true}}});
 mocks.blocked.mockResolvedValue([]);mocks.update.mockResolvedValue({count:1});
 expect((await claimNthMessage())?.id).toBe('guest');
 mocks.blocked.mockResolvedValue([{phone:'0637725045'}]);
 expect(await claimNthMessage()).toBeNull();
 expect(mocks.update.mock.calls.at(-1)[0].data.status).toBe('VIBER_CANCELLED');
});

it('keeps SMS campaigns isolated and rechecks SMS withdrawals for guest phones', async()=>{
 const phone='381637725045';
 mocks.candidates.mockResolvedValue([{id:'sms1',status:'VIBER_QUEUED',lockedAt:null,payload:{channels:['SMS'],transactionId:`cmp:c1:rcp:${storedPhoneRecipientId(phone)}`,destinations:[{phoneNumber:phone}]}}]);
 mocks.campaign.mockResolvedValue({status:'SENT',audience:{filter:{allStoredPhones:true,phoneScope:'current',channel:'SMS'}}});
 mocks.blocked.mockResolvedValue([]);mocks.update.mockResolvedValue({count:1});
 expect((await claimNthMessage())?.id).toBe('sms1');
 expect(mocks.blocked.mock.calls[0][0].sql).toContain('mc.sms');
 mocks.campaign.mockResolvedValue({status:'SENT',audience:{filter:{allStoredPhones:true}}});
 expect(await claimNthMessage()).toBeNull();
 expect(mocks.update.mock.calls.at(-1)[0].data.status).toBe('VIBER_CANCELLED');
});

it('allows only imported audience members and still rechecks withdrawals at worker time',async()=>{
 const phone='381637725045';
 mocks.candidates.mockResolvedValue([{id:'imported',status:'VIBER_QUEUED',lockedAt:null,payload:{channels:['SMS'],transactionId:`cmp:c1:rcp:${storedPhoneRecipientId(phone)}`,destinations:[{phoneNumber:phone}]}}]);
 mocks.campaign.mockResolvedValue({status:'SENT',audience:{filter:{channel:'SMS',importedContacts:[{phone,name:'Marko'}]}}});
 mocks.blocked.mockResolvedValue([]);mocks.update.mockResolvedValue({count:1});
 expect((await claimNthMessage())?.id).toBe('imported');
 mocks.blocked.mockResolvedValue([{phone}]);expect(await claimNthMessage()).toBeNull();
 mocks.blocked.mockResolvedValue([]);
 mocks.campaign.mockResolvedValue({status:'SENT',audience:{filter:{channel:'SMS',importedContacts:[{phone:'381641234567',name:'Ana'}]}}});
 expect(await claimNthMessage()).toBeNull();
 expect(mocks.update.mock.calls.at(-1)[0].data.status).toBe('VIBER_CANCELLED');
});
