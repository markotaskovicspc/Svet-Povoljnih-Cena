import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), lookup: vi.fn() }));
vi.mock("@/lib/admin", () => ({ requireAdminAction: mocks.auth }));
vi.mock("@/lib/api/reclamations", () => ({ lookupOrderForReclamation: mocks.lookup }));
import { POST } from "@/app/api/admin/reclamations/customer-link/route";
import { verifyReclamationLinkToken } from "@/lib/api/reclamation-link-token";
function request(number = "SPC-1") { return new Request("https://example.test/api/admin/reclamations/customer-link", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderNumberOrFiscal: number }) }); }
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv("AUTH_SECRET", "test-secret"); mocks.lookup.mockResolvedValue({ number: "SPC-1", status: "ISPORUCENO" }); });
afterEach(() => vi.unstubAllEnvs());
describe("admin copyable reclamation link", () => {
  it("requires staff access before reading an order", async () => {
    mocks.auth.mockRejectedValue(new Error("Forbidden"));
    await expect(POST(request())).rejects.toThrow("Forbidden");
    expect(mocks.lookup).not.toHaveBeenCalled();
  });
  it("returns an expiring reclamation-only URL and does not send email", async () => {
    const response = await POST(request());
    expect(mocks.auth).toHaveBeenCalledWith(["OPS"]);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const data = await response.json();
    const url = new URL(data.path, "https://example.test");
    expect(url.pathname).toBe("/reklamacije/prijava");
    expect(verifyReclamationLinkToken(url.searchParams.get("token"), "SPC-1")).toBe(true);
  });
  it("reports an unknown or undelivered order without making a link", async () => {
    mocks.lookup.mockResolvedValueOnce(null);
    expect((await POST(request())).status).toBe(404);
    mocks.lookup.mockResolvedValueOnce({ number: "SPC-1", status: "NOVO" });
    expect((await POST(request())).status).toBe(422);
  });
});
