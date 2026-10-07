import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ save: vi.fn(), eligible: vi.fn(), tag: vi.fn(), path: vi.fn(), guard: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { adminSetting: { upsert: mocks.save } } }));
vi.mock("next/cache", () => ({ updateTag: mocks.tag, revalidatePath: mocks.path }));
vi.mock("@/lib/landing-pages/standard-promo.server", () => ({ getStandardPromoSkus: mocks.eligible }));
vi.mock("@/lib/admin", () => ({ withAdminState: (options: unknown, callback: (actor: string, data: FormData) => Promise<unknown>) => {
  mocks.guard(options);
  return (data: FormData) => callback("content-admin", data);
} }));
import { saveStandardPromoOrder } from "@/app/admin/erp/landing-strane/standard-actions";

function form(key: string, skus: unknown) {
  const data = new FormData(); data.set("pageKey", key); data.set("productSkus", JSON.stringify(skus)); return data;
}
beforeEach(() => { vi.clearAllMocks(); mocks.eligible.mockResolvedValue(["A", "B", "NEW"]); mocks.save.mockResolvedValue({}); });

describe("standard promo order saving", () => {
  it("checks CONTENT permission and saves order with an audit author and invalidation", async () => {
    const result = await saveStandardPromoOrder({ ok: false }, form("heroji-meseca", ["B", "A"]));
    expect(result.ok).toBe(true);
    expect(mocks.guard).toHaveBeenCalledWith(expect.objectContaining({ allowed: ["CONTENT"] }));
    expect(mocks.eligible).toHaveBeenCalledWith("heroji-meseca", true);
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ update: { value: ["B", "A"], updatedBy: "content-admin" } }));
    expect(mocks.tag).toHaveBeenCalledWith("storefront-home");
    expect(mocks.path).toHaveBeenCalledWith("/heroji-meseca");
  });
  it("rejects products outside the live offer before writing", async () => {
    expect((await saveStandardPromoOrder({ ok: false }, form("heroji-meseca", ["UNKNOWN"]))).ok).toBe(false);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("rejects duplicate SKUs and arbitrary page keys", async () => {
    expect((await saveStandardPromoOrder({ ok: false }, form("heroji-meseca", ["A", "A"]))).ok).toBe(false);
    expect((await saveStandardPromoOrder({ ok: false }, form("made-up", ["A"]))).ok).toBe(false);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("resets automatic ordering even when the offer is empty", async () => {
    expect((await saveStandardPromoOrder({ ok: false }, form("heroji-meseca", []))).ok).toBe(true);
    expect(mocks.eligible).not.toHaveBeenCalled();
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ update: { value: [], updatedBy: "content-admin" } }));
  });
});
