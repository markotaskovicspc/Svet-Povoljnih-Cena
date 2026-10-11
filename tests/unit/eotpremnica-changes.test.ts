import { describe, expect, it, vi } from "vitest";
import { requestChanges } from "@/lib/eotpremnica/client";
const config = { baseUrl: "https://api.eotpremnica.mfin.gov.rs", apiKey: "test-secret" };
describe("eOtpremnica async confirmation", () => {
  it("reads zero-based pages and selects only the exact request", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ items: [{ requestId: "other", type: "DocumentRequest.Failed" }, { requestId: "mine", type: "DocumentRequest.Succeeded", data: { status: "Success", documentId: "remote-1" } }] })).mockResolvedValueOnce(Response.json({ items: [] }));
    const result = await requestChanges(config, "mine", "2026-10-11", fetcher);
    expect(result).toEqual([{ requestId: "mine", type: "DocumentRequest.Succeeded", documentId: "remote-1", status: "Success" }]);
    expect(fetcher.mock.calls.map(c => new URL(String(c[0])).searchParams.get("page"))).toEqual(["0", "1"]);
    expect(fetcher.mock.calls[0][1].headers["Api-key"]).toBe("test-secret");
  });
  it("rejects a repeated page instead of reporting a complete result", async () => {
    const body = { items: [{ requestId: "mine", type: "DocumentRequest.Succeeded" }] };
    await expect(requestChanges(config, "mine", "2026-10-11", vi.fn(async () => Response.json(body)))).rejects.toThrow("ponavlja");
  });
  it("rejects portal HTML instead of manufacturing successful API readiness", async () => {
    await expect(requestChanges(config, "mine", "2026-10-11", vi.fn(async () => new Response("<html>login</html>")))).rejects.toThrow();
  });
});
