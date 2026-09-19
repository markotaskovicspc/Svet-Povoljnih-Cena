import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ guard: vi.fn(), findMany: vi.fn() }));
vi.mock("@/lib/admin", () => ({ requireAdminAction: mocks.guard }));
vi.mock("@/lib/db", () => ({ db: { newsletterCampaignRecipient: { findMany: mocks.findMany } } }));
import { getNewsletterBounces } from "@/app/admin/newsletter/kampanje/[id]/bounce-actions";

beforeEach(() => { vi.resetAllMocks(); mocks.guard.mockResolvedValue({ id: "admin" }); });

it("does not disclose recipient addresses without newsletter admin permission", async () => {
  mocks.guard.mockRejectedValue(new Error("Forbidden"));
  await expect(getNewsletterBounces({ campaignId: "campaign" })).rejects.toThrow("Forbidden");
  expect(mocks.findMany).not.toHaveBeenCalled();
});

it("lists recorded bounces independently of the latest recipient status and recent-events limit", async () => {
  const bouncedAt = new Date("2026-09-19T15:00:00Z");
  mocks.findMany.mockResolvedValue([{ id: "old-bounce", email: "example@example.com", bouncedAt }]);
  const result = await getNewsletterBounces({ campaignId: "campaign" });
  expect(mocks.guard).toHaveBeenCalledWith(["ADS"]);
  expect(mocks.findMany.mock.calls[0][0].where).toEqual({ campaignId: "campaign", bouncedAt: { not: null } });
  expect(result).toEqual({ items: [{ id: "old-bounce", email: "example@example.com", bouncedAt: bouncedAt.toISOString() }], nextCursor: null });
});

it("bounds each request and carries a campaign-scoped continuation without losing the extra row", async () => {
  const rows = Array.from({ length: 51 }, (_, i) => ({ id: `r${String(i).padStart(3, "0")}`, email: `test${i}@example.com`, bouncedAt: new Date() }));
  mocks.findMany.mockResolvedValueOnce(rows).mockResolvedValueOnce([rows[50]]);
  const first = await getNewsletterBounces({ campaignId: "campaign" });
  const next = await getNewsletterBounces({ campaignId: "campaign", afterId: first.nextCursor! });
  expect(first.items).toHaveLength(50);
  expect(mocks.findMany.mock.calls[1][0]).toMatchObject({ where: { campaignId: "campaign", id: { gt: "r049" } }, take: 51, orderBy: { id: "asc" } });
  expect(next.items[0].id).toBe("r050");
  expect(next.nextCursor).toBeNull();
});
