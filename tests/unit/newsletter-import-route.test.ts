import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ admin: vi.fn(), start: vi.fn(), batch: vi.fn(), authorize: vi.fn(), due: vi.fn(), find: vi.fn(), process: vi.fn() }));
vi.mock("@/lib/admin", () => ({ requireAdminAction: mocks.admin }));
vi.mock("@/lib/newsletter/import-session", () => ({ startContactImport: mocks.start, importContactBatch: mocks.batch }));
vi.mock("@/lib/security/bearer", () => ({ isAuthorizedCronRequest: mocks.authorize }));
vi.mock("@/lib/db", () => ({ db: { backgroundJob: { findFirst: mocks.find } } }));
vi.mock("@/lib/background-jobs", () => ({ processBackgroundJob: mocks.process }));
vi.mock("@/lib/newsletter/campaigns", () => ({ enqueueDueNewsletterCampaigns: mocks.due }));
import { POST } from "@/app/api/admin/newsletter/contact-import/route";
import { GET } from "@/app/api/cron/newsletter/route";
beforeEach(() => { vi.resetAllMocks(); mocks.admin.mockResolvedValue({ id: "admin" }); });
it("rejects cross-origin imports without writing contacts", async () => {
  const response = await POST(new Request("https://example.com/api/admin/newsletter/contact-import", { method: "POST", headers: { origin: "https://evil.example" }, body: '{}' }));
  expect(response.status).toBe(403); expect(mocks.start).not.toHaveBeenCalled(); expect(mocks.batch).not.toHaveBeenCalled();
});
it("passes the authenticated actor and rejects oversized requests", async () => {
  mocks.start.mockResolvedValue({ id: "i" });
  const response = await POST(new Request("https://example.com/api/admin/newsletter/contact-import", { method: "POST", body: JSON.stringify({ operation: "start" }) }));
  expect(response.status).toBe(200); expect(mocks.admin).toHaveBeenCalledWith(["ADS"]);
  expect(mocks.start).toHaveBeenCalledWith({ operation: "start" }, "admin");
  expect((await POST(new Request("https://example.com/api/admin/newsletter/contact-import", { method: "POST", body: "x".repeat(2_500_001) }))).status).toBe(413);
});
it("never starts newsletter work without a valid cron secret", async () => {
  mocks.authorize.mockReturnValue(false);
  expect((await GET(new Request("https://example.com/api/cron/newsletter"))).status).toBe(401);
  expect(mocks.due).not.toHaveBeenCalled(); expect(mocks.process).not.toHaveBeenCalled();
});
it("processes only one due newsletter job using the existing atomic claim", async () => {
  mocks.authorize.mockReturnValue(true); mocks.find.mockResolvedValue({ id: "job" }); mocks.process.mockResolvedValue({ claimed: true });
  await GET(new Request("https://example.com/api/cron/newsletter"));
  expect(mocks.find.mock.calls[0][0].where.kind).toBe("NEWSLETTER_CAMPAIGN_SEND");
  expect(mocks.process).toHaveBeenCalledExactlyOnceWith("job");
});
