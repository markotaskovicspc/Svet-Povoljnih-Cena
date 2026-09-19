import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ campaign: vi.fn(), claim: vi.fn(), job: vi.fn(), resolve: vi.fn(), render: vi.fn(), remove: vi.fn(), create: vi.fn(), tx: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { newsletterCampaign: { findUniqueOrThrow: m.campaign }, $transaction: m.tx } }));
vi.mock("@/lib/newsletter/audience", async (original) => ({ ...await original<typeof import("@/lib/newsletter/audience")>(), resolveNewsletterAudience: m.resolve }));
vi.mock("@/lib/newsletter/content", async (original) => ({ ...await original<typeof import("@/lib/newsletter/content")>(), renderNewsletterCampaign: m.render }));
vi.mock("@/lib/email/config", () => ({ getEmailConfig: () => ({ provider: "ses", sesCredentialsConfigured: true, sesRegion: "eu-central-1", sesConfigurationSet: "test", sesSnsTopicArn: "test", baseUrl: "https://example.com", marketingFrom: "test@example.com" }) }));
import { scheduleNewsletterCampaign } from "@/lib/newsletter/campaigns";
const row = { id: "c", status: "IN_REVIEW", createdById: "admin", audienceId: "a", audienceMode: "DYNAMIC", subject: "Ponuda", content: [], updatedAt: new Date("2026-09-19") };
beforeEach(() => {
  vi.clearAllMocks();
  m.campaign.mockResolvedValue(row);
  m.claim.mockResolvedValue({count:1});m.job.mockResolvedValue({});
  m.resolve.mockResolvedValue({recipients:Array.from({length:1573},(_,i)=>({id:`r${i}`,email:`r${i}@example.com`,status:"ACTIVE"})),breakdown:{matched:1573}});
  m.render.mockResolvedValue({warnings:[],blocks:[{}]});
  m.tx.mockImplementation(fn=>fn({newsletterCampaign:{updateMany:m.claim},backgroundJob:{upsert:m.job},newsletterCampaignRecipient:{deleteMany:m.remove,createMany:m.create}}));
});
it.each(["DRAFT","IN_REVIEW","APPROVED"])("lets the same authorized admin schedule 1573 recipients from %s",async status=>{
  m.campaign.mockResolvedValue({...row,status});
  await scheduleNewsletterCampaign("c",new Date(),"admin");
  expect(m.claim).toHaveBeenCalledWith(expect.objectContaining({where:{id:"c",status,updatedAt:row.updatedAt},data:expect.objectContaining({status:"SCHEDULED",approvedById:"admin",recipients:1573})}));
  expect(m.job).toHaveBeenCalledOnce();
});
it("does not queue twice after another request already changed the campaign",async()=>{
  m.claim.mockResolvedValue({count:0});
  await expect(scheduleNewsletterCampaign("c",new Date(),"admin")).rejects.toThrow("u međuvremenu promenjena");
  expect(m.job).not.toHaveBeenCalled();
});
it.each(["SCHEDULED","SENDING","SENT","FAILED"])("rejects direct send for %s",async status=>{
  m.campaign.mockResolvedValue({...row,status});
  await expect(scheduleNewsletterCampaign("c",new Date(),"admin")).rejects.toThrow("već pokrenuta");
  expect(m.tx).not.toHaveBeenCalled();
});
it("retains content and empty-audience validation",async()=>{
  m.resolve.mockResolvedValue({recipients:[],breakdown:{matched:0}});
  await expect(scheduleNewsletterCampaign("c",new Date(),"admin")).rejects.toThrow("nijednog podobnog");
  expect(m.tx).not.toHaveBeenCalled();
});
it("claims a fixed audience before replacing its snapshot, in the same transaction",async()=>{
  m.campaign.mockResolvedValue({...row,audienceMode:"FIXED"});
  await scheduleNewsletterCampaign("c",new Date(),"admin");
  expect(m.remove).toHaveBeenCalledOnce();expect(m.create).toHaveBeenCalledOnce();
  expect(m.claim.mock.invocationCallOrder[0]).toBeLessThan(m.remove.mock.invocationCallOrder[0]);
  expect(m.create.mock.invocationCallOrder[0]).toBeLessThan(m.job.mock.invocationCallOrder[0]);
});
