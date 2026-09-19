import { beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { NEWSLETTER_IMAGE_MAX_BYTES, validateNewsletterImageFile } from "@/lib/newsletter/image-file";

const mocks = vi.hoisted(() => ({
  guard: vi.fn(), campaign: vi.fn(), upload: vi.fn(), from: vi.fn(),
  publicUrl: vi.fn(), remove: vi.fn(),
}));
vi.mock("@/lib/admin", () => ({ requireAdminAction: mocks.guard }));
vi.mock("@/lib/db", () => ({ db: { newsletterCampaign: { findUnique: mocks.campaign } } }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ storage: { from: mocks.from } }) }));
vi.mock("@/lib/supabase/storage", () => ({ getProductMediaBucket: () => "product-media" }));
import { POST } from "@/app/api/admin/newsletter-media/route";

function request(bytes: Uint8Array, type = "image/png", campaignId = "campaign-test") {
  const form = new FormData();
  form.set("campaignId", campaignId);
  form.set("file", new File([new Uint8Array(bytes).buffer], "test.png", { type }));
  return new Request("https://example.test/api/admin/newsletter-media", { method: "POST", body: form });
}
async function image() {
  return sharp({ create: { width: 2400, height: 600, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 0.5 } } }).png().toBuffer();
}

beforeEach(() => {
  mocks.guard.mockResolvedValue({ id: "admin" });
  mocks.campaign.mockResolvedValue({ status: "DRAFT" });
  mocks.upload.mockResolvedValue({ error: null });
  mocks.publicUrl.mockReturnValue({ data: { publicUrl: "https://media.example.test/newsletter/image.png" } });
  mocks.from.mockReturnValue({ upload: mocks.upload, getPublicUrl: mocks.publicUrl, remove: mocks.remove });
});

describe("newsletter image upload", () => {
  it("stores a bounded email image and returns a durable URL without editing/sending the campaign", async () => {
    const response = await POST(request(await image()));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ url: "https://media.example.test/newsletter/image.png" });
    expect(mocks.guard).toHaveBeenCalledWith(["ADS"]);
    expect(mocks.from).toHaveBeenCalledWith("product-media");
    const [key, bytes, options] = mocks.upload.mock.calls[0];
    expect(key).toMatch(/^newsletter\/campaign-test\/[a-f0-9-]+\.png$/);
    expect(options).toMatchObject({ contentType: "image/png", upsert: false });
    const metadata = await sharp(bytes).metadata();
    expect(metadata.width).toBe(2000);
    expect(metadata.hasAlpha).toBe(true);
  });
  it.each(["APPROVED", "SCHEDULED", "SENDING", "SENT"])("does not upload into a locked %s campaign", async status => {
    mocks.campaign.mockResolvedValue({ status });
    expect((await POST(request(await image()))).status).toBe(409);
    expect(mocks.upload).not.toHaveBeenCalled();
  });
  it("rejects a missing campaign", async () => {
    mocks.campaign.mockResolvedValue(null);
    expect((await POST(request(await image()))).status).toBe(404);
    expect(mocks.upload).not.toHaveBeenCalled();
  });
  it("does not swallow auth redirects", async () => {
    mocks.guard.mockRejectedValue(new Error("unauthorized"));
    await expect(POST(request(new Uint8Array([1])))).rejects.toThrow("unauthorized");
    expect(mocks.campaign).not.toHaveBeenCalled();
  });
  it("rejects disguised and corrupt images before storage", async () => {
    expect((await POST(request(await image(), "image/jpeg"))).status).toBe(400);
    expect((await POST(request(new TextEncoder().encode("not a photo")))).status).toBe(400);
    expect(mocks.upload).not.toHaveBeenCalled();
  });
  it("reports storage failures without returning a successful URL", async () => {
    mocks.upload.mockResolvedValue({ error: { message: "storage unavailable" } });
    expect((await POST(request(await image()))).status).toBe(502);
    expect(mocks.publicUrl).not.toHaveBeenCalled();
  });
  it("validates file limits in both UI and API", async () => {
    expect(() => validateNewsletterImageFile({ size: NEWSLETTER_IMAGE_MAX_BYTES + 1, type: "image/png" })).toThrow("4 MB");
    expect(() => validateNewsletterImageFile({ size: 12, type: "text/html" })).toThrow("JPG");
    expect(() => validateNewsletterImageFile({ size: 0, type: "image/png" })).toThrow("Izaberite");
    expect((await POST(request(new Uint8Array(NEWSLETTER_IMAGE_MAX_BYTES + 1)))).status).toBe(400);
    expect(mocks.upload).not.toHaveBeenCalled();
  });
});
