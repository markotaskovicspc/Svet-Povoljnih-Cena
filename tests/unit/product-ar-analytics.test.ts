import { beforeEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
const mocks = vi.hoisted(() => ({ create: vi.fn(), product: vi.fn(), count: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { analyticsEvent: { create: mocks.create }, product: { findUnique: mocks.product, count: mocks.count } } }));
vi.mock("@/lib/security/rate-limit", () => ({ checkRateLimitForRequest: async () => ({ ok: true }), rateLimitJson: vi.fn() }));
import { POST } from "@/app/api/analytics/events/route";
import { AR_EXPERIMENT, productArMetadataSchema } from "@/lib/analytics/product-ar-events";
import { androidArIntent, androidChromeArIntent, getProductArAsset } from "@/lib/product-ar";
const metadata = () => ({ event: "model_opened", eventId: randomUUID(), slug: "100010-9ce68e", experiment: AR_EXPERIMENT, variant: "B", device: "android", surface: "viewer", source: "facebook", medium: "paid_social", campaign: "desk", content: "video1" });
const request = (meta = metadata(), cookie = "analytics", productId?: string) => new Request("http://localhost/api/analytics/events", { method: "POST", headers: { cookie: `spc_cookie_consent=${cookie}`, "content-type": "application/json" }, body: JSON.stringify({ type: "PRODUCT_AR", anonymousId: "v2:test", consentVersion: "2026-08", metadata: meta, productId }) });
beforeEach(() => { vi.resetAllMocks(); mocks.product.mockResolvedValue({ id: "desk" }); mocks.create.mockResolvedValue({ id: "event" }); });
it("requires consent before any analytics write", async () => { expect((await POST(request(metadata(), "essential"))).status).toBe(403); expect(mocks.create).not.toHaveBeenCalled(); });
it("stores a separate AR event tied to the registered product and idempotency id", async () => {
  const meta = metadata(); expect((await POST(request(meta))).status).toBe(201);
  expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ type: "PRODUCT_AR", productId: "desk", id: `ar:${meta.eventId}`, metadata: meta }) }));
});
it("rejects unsupported chair, invalid stages, and mismatched product", async () => {
  for (const meta of [{ ...metadata(), slug: "100010-6b45ec" }, { ...metadata(), event: "ar_placed" }]) expect((await POST(request(meta))).status).toBe(400);
  expect((await POST(request(metadata(), "analytics", "other"))).status).toBe(400);
  expect(mocks.create).not.toHaveBeenCalled();
});
it("accepts retried event IDs without writing a second event", async () => { mocks.create.mockRejectedValue({ code: "P2002" }); expect((await POST(request())).status).toBe(201); });
it("rejects arbitrary metadata and oversized attribution", () => { expect(productArMetadataSchema.safeParse({ ...metadata(), cameraImage: "x" }).success).toBe(false); expect(productArMetadataSchema.safeParse({ ...metadata(), content: "a".repeat(121) }).success).toBe(false); });
it("preserves QR campaign and variant through Android fallback and Chrome handoff", () => {
  const url = "https://example.com/ar/100010-9ce68e?ar_entry=qr&ar_variant=B&utm_campaign=desk&utm_content=video1";
  const intent = androidArIntent(getProductArAsset("100010-9ce68e")!, url);
  const fallback = new URL(decodeURIComponent(intent.split("S.browser_fallback_url=")[1].split(";")[0]));
  expect(fallback.searchParams.get("ar_entry")).toBe("qr"); expect(fallback.searchParams.get("utm_content")).toBe("video1"); expect(fallback.searchParams.get("manual")).toBe("1");
  expect(androidChromeArIntent(url)).toContain("ar_variant=B"); expect(androidChromeArIntent(url)).toContain("utm_campaign=desk");
});
