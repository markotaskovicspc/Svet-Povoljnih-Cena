import { beforeEach, afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { $executeRaw: mocks.execute } }));
import { POST } from "@/app/api/product-ar/count/route";
const payload = { slug: "100010-9ce68e", event: "model_opened" };
const request = (body: unknown = payload, origin = "https://shop.test") => new Request("https://shop.test/api/product-ar/count", { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) });
beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
it("increments only a daily aggregate, without consent, cookies or visitor records", async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-12T22:30:00Z"));
  const result = await POST(request());
  expect(result.status).toBe(204); expect(result.headers.get("set-cookie")).toBeNull();
  expect(result.headers.get("cache-control")).toBe("no-store");
  const sql = mocks.execute.mock.calls[0][0];
  expect(sql.values).toEqual([new Date("2026-09-13T00:00:00Z"), payload.slug, payload.event]);
  expect(sql.sql).toContain("ON CONFLICT");
});
it("rejects personal fields, unknown events, removed chair, other origins and oversized bodies", async () => {
  for (const body of [{...payload, anonymousId:"id"}, {...payload, ip:"127.0.0.1"}, {...payload, campaign:"ad"}, {...payload,event:"ar_placed"}, {...payload,slug:"100010-6b45ec"}]) expect((await POST(request(body))).status).toBe(400);
  expect((await POST(request(payload,"https://other.test"))).status).toBe(403);
  expect((await POST(request({slug:"x".repeat(300),event:"model_opened"}))).status).toBe(413);
  expect(mocks.execute).not.toHaveBeenCalled();
});
it("client sends only allowed action data with no credentials/referrer and deduplicates model remounts", async () => {
  vi.resetModules(); const fetch = vi.fn().mockResolvedValue({}); vi.stubGlobal("fetch", fetch);
  const { countProductAr } = await import("@/lib/analytics/product-ar-counter-client");
  countProductAr(payload.slug,"model_requested"); expect(fetch).not.toHaveBeenCalled();
  countProductAr(payload.slug,"model_opened"); countProductAr(payload.slug,"model_opened");
  countProductAr(payload.slug,"ar_clicked"); countProductAr(payload.slug,"ar_clicked");
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(fetch.mock.calls[0]).toEqual(["/api/product-ar/count", { method:"POST", credentials:"omit", referrerPolicy:"no-referrer", headers:{"content-type":"application/json"}, body:JSON.stringify(payload), keepalive:true }]);
});
