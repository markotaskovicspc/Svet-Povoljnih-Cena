import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
const mocks = vi.hoisted(() => ({
  contacts: vi.fn(), suppressed: vi.fn(), behavior: vi.fn(), campaign: vi.fn(), recipientCount: vi.fn(),
  recipients: vi.fn(), updateMany: vi.fn(), update: vi.fn(), jobs: vi.fn(), tx: vi.fn(), bulk: vi.fn(),
  render: vi.fn(), tracked: vi.fn(), eventRecipient: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  databaseIdentifier: (name: string) => Prisma.raw(`"${name}"`),
  db: {
    marketingContact: { findMany: mocks.contacts }, emailSuppression: { findMany: mocks.suppressed },
    $queryRaw: mocks.behavior, $transaction: mocks.tx,
    newsletterCampaign: { findUniqueOrThrow: mocks.campaign, update: mocks.update },
    newsletterCampaignRecipient: { count: mocks.recipientCount, findMany: mocks.recipients, updateMany: mocks.updateMany, groupBy: vi.fn().mockResolvedValue([]), findFirst: mocks.eventRecipient },
    backgroundJob: { upsert: mocks.jobs },
  },
}));
vi.mock("@/lib/newsletter/delivery-pacing", () => ({ withNewsletterDeliveryPacing: (_region: string, send: () => Promise<unknown>) => send() }));
vi.mock("@/lib/email/config", () => ({ getEmailConfig: () => ({ provider: "ses", sesCredentialsConfigured: true, sesRegion: "eu-central-1", sesConfigurationSet: "test", sesSnsTopicArn: "test", baseUrl: "https://example.com", marketingFrom: "test@example.com" }) }));
vi.mock("@/lib/email/ses", () => ({ dispatchSesBulk: mocks.bulk }));
vi.mock("@/lib/email/tracking", () => ({ trackedDispatch: mocks.tracked }));
vi.mock("@/lib/email/unsubscribe", () => ({ buildEmailUnsubscribeUrl: () => "https://example.com/unsubscribe/signed" }));
vi.mock("@/lib/newsletter/content", async () => {
  const { z } = await import("zod");
  return { newsletterContentSchema: z.array(z.unknown()), defaultNewsletterContent: () => [], renderNewsletterCampaign: mocks.render };
});
import { builtInNewsletterAudiences, matchesAudienceFilter, resolveNewsletterAudience } from "@/lib/newsletter/audience";
import { saveCampaignSchema, sendNewsletterCampaign, sendNewsletterCampaignTest, NewsletterSendPausedError } from "@/lib/newsletter/campaigns";
import { recordSesNewsletterEvent } from "@/lib/newsletter/ses-events";

const contact = { id: "c1", email: "guest@example.com", firstName: null, lastName: null, language: "sr-Latn", status: "ACTIVE", subscribedAt: new Date(), userId: null, tags: [], source: "footer" };
const recipient = { id: "r1", contactId: "c1", email: contact.email, contact, status: "QUEUED", campaignId: "campaign1" };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.contacts.mockResolvedValue([contact]); mocks.suppressed.mockResolvedValue([]);
  mocks.behavior.mockResolvedValue([{ contactId: "c1", registered: false, hasPurchased: true, abandonedCheckout: false }]);
  mocks.campaign.mockResolvedValue({ id: "campaign1", status: "SENDING", audienceMode: "DYNAMIC", subject: "Ponuda", content: [], audienceFilterSnapshot: {}, createdById: "a1", approvedById: "a2" });
  mocks.recipientCount.mockImplementation(async ({ where }) => where.status === "COMPLAINED" || where.status === "BOUNCED" || where.status === "QUEUED" || where.status?.in?.includes("FAILED") ? 0 : 1);
  mocks.recipients.mockImplementation(async ({ where }) => typeof where.campaignId === "object" ? [] : [recipient]);
  mocks.updateMany.mockResolvedValue({ count: 1 }); mocks.update.mockResolvedValue({}); mocks.jobs.mockResolvedValue({});
  mocks.tx.mockImplementation(async (items) => Promise.all(items));
  mocks.render.mockResolvedValue({ html: "<p>Saved version</p>", text: "Saved version", warnings: [], blocks: [{}] });
  mocks.bulk.mockResolvedValue({ ok: true, results: [{ email: contact.email, ok: true, id: "ses1", error: null }] });
  mocks.tracked.mockResolvedValue({ ok: true, provider: "ses", id: "test1" });
});

describe("newsletter audience and send safeguards", () => {
  it("requires explicit broader selection and never includes withdrawals or suppression", async () => {
    mocks.contacts.mockResolvedValue([
      { ...contact, id: "pending", email: "pending@example.com", status: "PENDING", subscribedAt: null },
      { ...contact, id: "missing", email: "missing@example.com", subscribedAt: null },
      { ...contact, id: "withdrawn", status: "UNSUBSCRIBED" },
      { ...contact, id: "suppressed", status: "SUPPRESSED" },
      { ...contact, id: "old-withdrawal", unsubscribedAt: new Date() }, contact,
    ]);
    expect((await resolveNewsletterAudience({})).recipients.map((row) => row.id)).toEqual(["c1"]);
    const result = await resolveNewsletterAudience({}, { includeContactsWithoutConsent: true });
    expect(result.recipients.map((row) => row.id)).toEqual(["pending", "missing", "c1"]);
    expect(result.breakdown.matchedWithoutConsent).toBe(2);
    expect(result.recipients[0].status).toBe("PENDING");
    expect(saveCampaignSchema.parse({ id: "x", title: "x", subject: "x", content: [] }).includeContactsWithoutConsent).toBe(false);
    expect(saveCampaignSchema.parse({ id: "x", title: "x", subject: "x", content: [], includeContactsWithoutConsent: true }).includeContactsWithoutConsent).toBe(true);
  });
  it("allows an explicitly selected pending contact through the final SES guard without granting consent", async () => {
    const pending = { ...contact, status: "PENDING", subscribedAt: null };
    mocks.contacts.mockResolvedValue([pending]);
    mocks.recipients.mockImplementation(async ({ where }) => typeof where.campaignId === "object" ? [] : [{ ...recipient, contact: pending }]);
    mocks.campaign.mockResolvedValue({ id: "campaign1", status: "SENDING", audienceMode: "DYNAMIC", subject: "Ponuda", content: [], audienceFilterSnapshot: {}, includeContactsWithoutConsent: true, createdById: "a1", approvedById: "a2" });
    mocks.behavior.mockResolvedValue([{ id: "r1" }]);
    await sendNewsletterCampaign("campaign1");
    expect(mocks.bulk).toHaveBeenCalledOnce();
    const query = mocks.behavior.mock.calls[0][0];
    expect(query.values).toContain(true);
    expect(query.sql).toContain('c."unsubscribedAt" IS NULL');
    expect(query.sql).toContain('c."suppressedAt" IS NULL');
    expect(query.sql).toContain("IN ('ACTIVE', 'PENDING')");
  });
  it("includes opted-in guest buyers in the built-in buyers group", async () => {
    const result = await resolveNewsletterAudience(builtInNewsletterAudiences.find((row) => row.id === "builtin:buyers")!.filter);
    expect(result.recipients.map((row) => row.id)).toEqual(["c1"]);
    expect(mocks.behavior.mock.calls[0][0].sql).toContain('lower(o."guestEmail")');
  });
  it("excludes converted checkout contacts and rejects invalid boolean operators", async () => {
    const result = await resolveNewsletterAudience(builtInNewsletterAudiences.find((row) => row.id === "builtin:abandoned")!.filter);
    expect(result.recipients).toEqual([]);
    expect(mocks.behavior.mock.calls[0][0].sql).toContain("AND NOT EXISTS");
    expect(() => matchesAudienceFilter({} as never, { groups: [{ id: "x", rules: [{ id: "r", field: "abandonedCheckout", operator: "contains", value: "yes" }] }] })).toThrow();
  });
  it("sends a test only to the normalized address and uses saved campaign content", async () => {
    await sendNewsletterCampaignTest("campaign1", " OWNER@Example.com ");
    expect(mocks.tracked).toHaveBeenCalledWith(expect.objectContaining({ to: "owner@example.com", subject: "[TEST] Ponuda", html: "<p>Saved version</p>" }));
    expect(mocks.bulk).not.toHaveBeenCalled(); expect(mocks.update).not.toHaveBeenCalled();
  });
  it("rejects a test from a stale editor version", async () => {
    mocks.campaign.mockResolvedValue({ id: "campaign1", updatedAt: new Date("2026-09-19T10:00:00Z") });
    await expect(sendNewsletterCampaignTest("campaign1", "owner@example.com", "2026-09-19T09:00:00.000Z")).rejects.toThrow("Osvežite pregled");
    expect(mocks.tracked).not.toHaveBeenCalled();
  });
  it("durably claims a batch before SES and does not requeue ambiguous timeouts", async () => {
    mocks.behavior.mockResolvedValue([{ id: "r1" }]);
    mocks.bulk.mockImplementation(async () => {
      expect(mocks.behavior.mock.calls[0][0].sql).toContain("ses:delivery_unknown");
      return { ok: false, error: "ses:TimeoutError response lost" };
    });
    await expect(sendNewsletterCampaign("campaign1")).rejects.toBeInstanceOf(NewsletterSendPausedError);
    expect(mocks.updateMany.mock.calls.some(([arg]) => arg.data.status === "QUEUED")).toBe(false);
  });
  it("records explicit AWS permission rejection as failed without requeueing or claiming an unknown outcome", async () => {
    mocks.behavior.mockResolvedValue([{ id: "r1" }]);
    const error = "ses:AccessDeniedException status=403 requestId=test retryable=false message=not authorized to perform ses:SendBulkEmail";
    mocks.bulk.mockResolvedValue({ ok: false, error });
    await expect(sendNewsletterCampaign("campaign1")).rejects.toBeInstanceOf(NewsletterSendPausedError);
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["r1"] }, status: "FAILED", failureReason: "ses:delivery_unknown" },
      data: { failureReason: error },
    });
    expect(mocks.updateMany.mock.calls.some(([arg]) => arg.data.status === "QUEUED")).toBe(false);
  });
  it("requeues an explicitly rejected throttled request", async () => {
    mocks.behavior.mockResolvedValue([{ id: "r1" }]); mocks.bulk.mockResolvedValue({ ok: false, error: "ses:TooManyRequestsException throttled" });
    await expect(sendNewsletterCampaign("campaign1")).rejects.toThrow();
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "QUEUED" }) }));
  });
  it("never sends a batch already claimed by another worker", async () => {
    mocks.behavior.mockResolvedValue([]);
    await sendNewsletterCampaign("campaign1");
    expect(mocks.bulk).not.toHaveBeenCalled();
  });
  it("stops remaining batches when a complaint is received", async () => {
    mocks.recipientCount.mockResolvedValue(1);
    await expect(sendNewsletterCampaign("campaign1")).rejects.toThrow("Zaštita reputacije");
    expect(mocks.bulk).not.toHaveBeenCalled();
  });
  it("recovers an ambiguous send from a signed SES delivery event without resending", async () => {
    mocks.eventRecipient.mockResolvedValue({ ...recipient, status: "FAILED", failureReason: "ses:delivery_unknown", sentAt: null });
    await recordSesNewsletterEvent("email.delivered", "ses1", { destination: [contact.email], tags: { recipient: ["r1"], campaign: ["campaign1"] } });
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "DELIVERED", providerMessageId: "ses1", failureReason: null }) }));
    expect(mocks.bulk).not.toHaveBeenCalled();
  });
});

it("includes guest purchase amounts, cities, vouchers and products in advanced filters", async () => {
  mocks.behavior.mockImplementation(async (query) => query.sql.includes('WITH matched_orders')
    ? [{contactId:"c1",sku:"GUEST-SKU",categoryPath:"odeca"}]
    : [{contactId:"c1",orderCount:2,totalSpend:50000,lastPurchaseAt:new Date(),cities:["Beograd"],vouchers:["WELCOME"]}]);
  const result = await resolveNewsletterAudience({groups:[{id:"g",rules:[
    {id:"n",field:"orderCount",operator:"gte",value:2},
    {id:"s",field:"totalSpend",operator:"gte",value:40000},
    {id:"c",field:"city",operator:"equals",value:"Beograd"},
    {id:"v",field:"voucher",operator:"equals",value:"WELCOME"},
    {id:"p",field:"purchasedSku",operator:"equals",value:"GUEST-SKU"},
  ]}]});
  expect(result.recipients.map(r=>r.id)).toEqual(["c1"]);
  for(const [query] of mocks.behavior.mock.calls) {
    expect(query.sql).toContain('lower(o."guestEmail") = lower(c."email")');
    expect(query.sql).toContain("'KREIRANO', 'OTKAZANO', 'VRACENO'");
  }
});
it("does not stamp an all-failed SES campaign as accepted", async () => {
  mocks.recipients.mockResolvedValue([]);
  mocks.recipientCount.mockImplementation(async ({where}) => {
    if (where.status === "QUEUED") return 0;
    if (where.OR?.some((item: {sentAt?:unknown})=>item.sentAt)) return 0;
    if (where.status?.in?.includes("FAILED")) return 10;
    return 10;
  });
  await sendNewsletterCampaign("campaign1");
  expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({status:"FAILED",sentAt:null})}));
});
