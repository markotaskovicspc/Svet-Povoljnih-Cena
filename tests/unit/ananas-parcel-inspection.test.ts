import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ auth: vi.fn(), rate: vi.fn() }));
vi.mock("@/lib/admin", () => ({ requireAdminAction: m.auth }));
vi.mock("@/lib/security/rate-limit", () => ({ checkRateLimit: m.rate }));
import { summarize } from "@/lib/ananas/parcel-inspection";
import { GET } from "@/app/api/admin/ananas/parcel-inspection/route";
beforeEach(() => vi.clearAllMocks());
describe("temporary Ananas inspection", () => {
  it("returns schema and reference metadata without raw PII or secret fields", () => {
    const result = summarize({ content: [{ orderId: "A-B", suborderId: "A-B-DS-1", status: "RETURN_TO_SELLER", customerEmail: "private@example.test", returnTrackingNumber: "KAP0000289404", token: "private-secret", labelUrl: "https://example.test/signed-secret" }], totalElements: 1, last: true });
    const json = JSON.stringify(result);
    expect(json).toContain("returnTrackingNumber"); expect(json).toContain('"KAP0000289404":true');
    expect(json).not.toContain("private@example.test"); expect(json).not.toContain("private-secret"); expect(json).not.toContain("signed-secret");
  });
  it("requires SUPER authorization before making any external request", async () => {
    m.auth.mockRejectedValue(new Error("Unauthorized"));
    const fetch = vi.spyOn(globalThis, "fetch");
    await expect(GET()).rejects.toThrow("Unauthorized");
    expect(m.auth).toHaveBeenCalledWith(["SUPER"]); expect(fetch).not.toHaveBeenCalled(); fetch.mockRestore();
  });
});
