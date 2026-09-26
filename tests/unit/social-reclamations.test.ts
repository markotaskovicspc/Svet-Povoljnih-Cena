import { afterEach, beforeEach, expect, it, vi } from "vitest";
import sharp from "sharp";
const m = vi.hoisted(() => ({ order: vi.fn(), existing: vi.fn(), create: vi.fn(), token: vi.fn(), rate: vi.fn(), mail: vi.fn(), upload: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { order: { findFirst: m.order }, reclamation: { findUnique: m.existing } } }));
vi.mock("@/lib/api/order-access", () => ({ verifyOrderAccessToken: m.token }));
vi.mock("@/lib/api/reclamations", async importOriginal => ({ ...await importOriginal<object>(), createSocialReclamation: m.create }));
vi.mock("@/lib/security/rate-limit", () => ({ checkRateLimit: m.rate, rateLimitKey: (...x: string[]) => x.join(":") }));
vi.mock("@/lib/email/tracking", () => ({ trackedDispatch: m.mail }));
vi.mock("@/lib/api/uploads", () => ({ isAllowedReclamationPhotoUrl: (x: string) => x.startsWith("reclamation/"), uploadAdminReclamationPhoto: m.upload }));
import { handleSocialReclamation as handle, allowedMetaPhotoUrl, socialReclamationActions } from "@/lib/social/reclamations";
import { readSocialQuote, signSocialQuote } from "@/lib/social/security";
const secret = "synthetic-secret-".repeat(4);
const identity = { channel: "facebook" as const, conversationId: "fb:page:buyer" };
const order = { id: "order1", number: "SPC-TEST-1", status: "ISPORUCENO", guestEmail: "buyer@example.test", user: null, publicAccessTokenHash: "hash", items: [{ sku: "IRON", name: "Pegla", qty: 1 }], reclamations: [] };
const input = { orderNumberOrFiscal: order.number, sku: "IRON", quantity: 1, description: "Pegla uopšte ne greje", photos: [], category: "KVAR" as const, request: "ZAMENA" as const };
const prep = () => handle({ action: "prepare_reclamation", ...identity, number: order.number, accessToken: "private", requestId: "12345678-1234-4234-a234-123456789012", input, transcript: "Kupac: Pegla ne greje" }, secret);
beforeEach(() => { vi.resetAllMocks(); m.order.mockResolvedValue(order); m.token.mockReturnValue(true); m.existing.mockResolvedValue(null); m.rate.mockResolvedValue({ ok: true }); m.mail.mockResolvedValue({ ok: true, provider: "resend" }); m.create.mockResolvedValue({ ok: true, id: "case", number: "R-1-SPC-TEST-1" }); });
afterEach(() => vi.unstubAllGlobals());

it("does not expose guessed order details or prepare a claim without ownership", async () => {
  m.token.mockReturnValue(false);
  expect(await handle({ action: "reclamation_details", ...identity, number: order.number, accessToken: "wrong" }, secret)).toMatchObject({ ok: false });
  expect(await prep()).toMatchObject({ ok: false }); expect(m.create).not.toHaveBeenCalled();
});
it("prepares only an actual purchased item and quantity, and never changes a stale delivery status", async () => {
  const prepared = await prep(); expect(prepared).toMatchObject({ ok: true, name: "Pegla" }); expect(m.create).not.toHaveBeenCalled();
  m.order.mockResolvedValue({ ...order, items: [{ sku: "BED", qty: 1 }] }); expect(await prep()).toMatchObject({ error: { code: "ITEM_NOT_FOUND" } });
  m.order.mockResolvedValue({ ...order, items: [{ sku: "IRON", qty: 0 }] }); expect(await prep()).toMatchObject({ error: { code: "QUANTITY_EXCEEDED" } });
  m.order.mockResolvedValue({ ...order, status: "U_ISPORUCI" }); expect(await prep()).toMatchObject({ error: { code: "ORDER_NOT_DELIVERED" } });
});
it("binds submitted case to immutable summary, purpose and conversation; recovers past expiry", async () => {
  const prepared = await prep(); if (!("reclamationToken" in prepared)) throw Error("No draft");
  const submit = { action: "submit_reclamation" as const, ...identity, reclamationToken: prepared.reclamationToken };
  expect(await handle({ ...submit, conversationId: "other" }, secret)).toMatchObject({ ok: false });
  expect(await handle({ ...submit, reclamationToken: signSocialQuote({ purpose: "cancel_order", ...identity }, secret) }, secret)).toMatchObject({ ok: false });
  expect(await handle(submit, secret)).toMatchObject({ ok: true });
  expect(m.create).toHaveBeenCalledWith(expect.objectContaining(input), expect.objectContaining({ orderId: order.id, request: "ZAMENA", type: "KVAR", note: expect.stringContaining("Kupac: Pegla ne greje") }));
  m.create.mockClear(); const token = readSocialQuote(prepared.reclamationToken, secret) as object;
  const expired = { ...submit, reclamationToken: signSocialQuote({ ...token, expiresAt: Date.now() - 1 }, secret) };
  expect(await handle(expired, secret)).toMatchObject({ error: { code: "RECLAMATION_EXPIRED" } });
  m.existing.mockResolvedValue({ id: "case", number: "R-1-SPC-TEST-1", orderId: order.id });
  expect(await handle(expired, secret)).toMatchObject({ ok: true, number: "R-1-SPC-TEST-1" }); expect(m.create).not.toHaveBeenCalled();
});
it("e-mail verification sends only to matching address and discloses no mismatch", async () => {
  const start = { action: "reclamation_verify_start" as const, ...identity, number: order.number, email: "wrong@example.test" };
  expect(await handle(start, secret)).toMatchObject({ ok: true, challenge: expect.any(String) }); expect(m.mail).not.toHaveBeenCalled();
  const result = await handle({ ...start, email: order.guestEmail }, secret); if (!("challenge" in result)) throw Error("No challenge");
  expect(m.mail).toHaveBeenCalledTimes(1); const code = m.mail.mock.calls[0][0].text.match(/\b\d{6}\b/)[0];
  expect(JSON.stringify(result)).not.toContain(code); m.token.mockReturnValue(false);
  const finish = { action: "reclamation_verify_finish" as const, ...identity, challenge: result.challenge, code };
  expect(await handle({ ...finish, channel: "instagram" }, secret)).toMatchObject({ ok: false });
  const verified = await handle(finish, secret); if (!("proof" in verified)) throw Error("No proof");
  expect(await handle({ action: "reclamation_details", ...identity, number: order.number, proof: verified.proof }, secret)).toMatchObject({ ok: true, order: { items: order.items } });
  expect(await handle({ action: "reclamation_details", ...identity, conversationId: "other", number: order.number, proof: verified.proof }, secret)).toMatchObject({ ok: false });
  m.rate.mockResolvedValue({ ok: false }); expect(await handle(finish, secret)).toMatchObject({ error: { code: "VERIFICATION_LIMIT" } });
});
it("limits expiry and attempts, never accepts a fabricated ownership proof", async () => {
  m.token.mockReturnValue(false);
  const proof = signSocialQuote({ ...identity, purpose: "reclamation_owner", orderId: order.id, number: order.number, expiresAt: Date.now() - 1 }, secret);
  expect(await handle({ action: "reclamation_details", ...identity, number: order.number, proof }, secret)).toMatchObject({ ok: false });
  expect(await handle({ action: "reclamation_verify_finish", ...identity, challenge: "forged", code: "123456" }, secret)).toMatchObject({ ok: false });
  m.rate.mockResolvedValue({ ok: false });
  expect(await handle({ action: "reclamation_verify_start", ...identity, number: order.number, email: order.guestEmail }, secret)).toMatchObject({ error: { code: "VERIFICATION_LIMIT" } }); expect(m.mail).not.toHaveBeenCalled();
});
it("rejects SSRF destinations, unsupported photo formats and oversized schemas", () => {
  for (const url of ["http://scontent.xx.fbcdn.net/a", "https://127.0.0.1/a", "https://fbcdn.net.evil.test/a", "https://user:pass@scontent.fbcdn.net/a", "https://scontent.fbcdn.net:8443/a"]) expect(allowedMetaPhotoUrl(url)).toBe(false);
  expect(allowedMetaPhotoUrl("https://scontent.xx.fbcdn.net/a.jpg?token=synthetic")).toBe(true);
  const schema = socialReclamationActions.find(s => s.shape.action.value === "prepare_reclamation")!;
  expect(schema.safeParse({ action: "prepare_reclamation", ...identity, number: order.number, requestId: "12345678-1234-4234-a234-123456789012", input: { ...input, photos: [{ url: "https://attacker.test/image" }] }, transcript: "" }).success).toBe(false);
});
it("imports a bounded image into private storage scoped to the purchased item; rejects html and oversized bodies", async () => {
  const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: "white" } }).png().toBuffer();
  const fetcher = vi.fn(async () => new Response(new Uint8Array(png))); vi.stubGlobal("fetch", fetcher);
  m.upload.mockResolvedValue({ url: "reclamation/SPC-TEST-1/IRON/date/file.jpg", bytes: 200 });
  const action = { action: "reclamation_photo" as const, ...identity, number: order.number, accessToken: "private", sku: "IRON", url: "https://scontent.xx.fbcdn.net/photo.jpg" };
  expect(await handle(action, secret)).toMatchObject({ ok: true });
  expect(m.upload).toHaveBeenCalledWith(expect.any(File), { orderNumber: order.number, sku: "IRON" });
  expect(fetcher).toHaveBeenCalledWith(action.url, expect.objectContaining({ redirect: "error" }));
  m.upload.mockClear(); fetcher.mockImplementation(async () => new Response("<html>Not an image</html>"));
  expect(await handle(action, secret)).toMatchObject({ error: { code: "PHOTO_UNAVAILABLE" } }); expect(m.upload).not.toHaveBeenCalled();
  fetcher.mockImplementation(async () => new Response(new Uint8Array(10 * 1024 * 1024 + 1)));
  expect(await handle(action, secret)).toMatchObject({ error: { code: "PHOTO_UNAVAILABLE" } }); expect(m.upload).not.toHaveBeenCalled();
  fetcher.mockClear(); expect(await handle({ ...action, sku: "BED" }, secret)).toMatchObject({ ok: false }); expect(fetcher).not.toHaveBeenCalled();
});
