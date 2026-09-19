import { beforeEach, expect, it, vi } from "vitest";
const mocks=vi.hoisted(()=>({campaign:vi.fn(),claim:vi.fn(),recipientCount:vi.fn(),requeue:vi.fn(),job:vi.fn(),resetJob:vi.fn(),createJob:vi.fn(),tx:vi.fn()}));
vi.mock("@/lib/db",()=>({db:{$transaction:mocks.tx}}));
import { retryNewsletterCampaign, retryableNewsletterRecipientWhere } from "@/lib/newsletter/retry";
beforeEach(()=>{
 vi.clearAllMocks();
 mocks.campaign.mockResolvedValue({id:"c",status:"PARTIAL_FAILED",updatedAt:new Date("2026-09-19"),failureReason:"original AWS failure"});
 mocks.claim.mockResolvedValue({count:1});mocks.requeue.mockResolvedValue({count:10});
 mocks.recipientCount.mockImplementation(async({where})=>where.status==="QUEUED"?324:where.status==="FAILED"?10:334);
 mocks.job.mockResolvedValue({id:"j"});mocks.resetJob.mockResolvedValue({count:1});
 mocks.tx.mockImplementation(fn=>fn({newsletterCampaign:{findUniqueOrThrow:mocks.campaign,updateMany:mocks.claim},newsletterCampaignRecipient:{count:mocks.recipientCount,updateMany:mocks.requeue},backgroundJob:{findUnique:mocks.job,updateMany:mocks.resetJob,create:mocks.createJob}}));
});
it("resumes the original snapshot, requeues explicit failures, and reports retained unknowns",async()=>{
 const result=await retryNewsletterCampaign("c","admin");
 expect(result).toMatchObject({queued:324,requeued:10,unknown:10,previousFailureReason:"original AWS failure"});
 expect(mocks.claim.mock.calls[0][0].data.status).toBe("SENDING");
 expect(mocks.requeue).toHaveBeenCalledWith({where:retryableNewsletterRecipientWhere("c"),data:{status:"QUEUED",failureReason:null}});
 expect(mocks.resetJob.mock.calls[0][0].where).toEqual({id:"j",status:{not:"RUNNING"}});
});
it("never blindly retries the old campaign whose 334 outcomes are all unknown",async()=>{
 mocks.requeue.mockResolvedValue({count:0});mocks.recipientCount.mockImplementation(async({where})=>where.status==="QUEUED"?0:334);
 await expect(retryNewsletterCampaign("c","admin")).rejects.toThrow("Za 334 poruka ishod nije poznat");
 expect(mocks.resetJob).not.toHaveBeenCalled();
});
it("guards every acceptance/opt-out signal in the retry predicate",()=>{
 const where=retryableNewsletterRecipientWhere("c");
 expect(where).toMatchObject({status:"FAILED",sentAt:null,providerMessageId:null,deliveredAt:null,openedAt:null,clickedAt:null,bouncedAt:null,complainedAt:null,unsubscribedAt:null});
 expect(JSON.stringify(where)).not.toContain("delivery_unknown");
});
it("does not overwrite a concurrent campaign transition",async()=>{
 mocks.claim.mockResolvedValue({count:0});
 await expect(retryNewsletterCampaign("c","admin")).rejects.toThrow("u međuvremenu promenjena");expect(mocks.requeue).not.toHaveBeenCalled();
});
it("does not reset a running worker",async()=>{
 mocks.resetJob.mockResolvedValue({count:0});
 await expect(retryNewsletterCampaign("c","admin")).rejects.toThrow("već u obradi");
});
it("can prepare a campaign whose failure happened before recipients were created",async()=>{
 mocks.recipientCount.mockResolvedValue(0);mocks.requeue.mockResolvedValue({count:0});mocks.job.mockResolvedValue(null);
 await retryNewsletterCampaign("c","admin");
 expect(mocks.claim.mock.calls[0][0].data.status).toBe("SCHEDULED");expect(mocks.createJob).toHaveBeenCalledOnce();
});
it("only requeues ambiguous outcomes after separate explicit acknowledgment, preserving delivery guards",async()=>{
 const result=await retryNewsletterCampaign("c","admin",{retryUnknownAcknowledged:true});
 expect(mocks.requeue).toHaveBeenCalledTimes(2);
 expect(mocks.requeue.mock.calls[1][0]).toEqual({where:{...retryableNewsletterRecipientWhere("c"),OR:undefined,failureReason:"ses:delivery_unknown"},data:{status:"QUEUED",failureReason:null}});
 expect(result).toMatchObject({retryUnknownAcknowledged:true,unknownRequeued:10});
});
