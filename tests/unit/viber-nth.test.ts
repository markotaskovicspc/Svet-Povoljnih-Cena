import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildNthPayload, dispatchNth, nthPhoneNumber } from "@/lib/viber/nth";
import { __resetViberConfig, getViberConfig } from "@/lib/viber/config";
import { dispatch } from "@/lib/viber/transport";

const cfg = {
  provider: "nth" as const, deliveryMode: "direct" as const, accepted: true, apiKey: null,
  username: "test-user", password: "test-password", sender: "Svet povoljnih cena",
  senderAvatar: null, webhookSecret: null, baseUrl: "https://example.com",
  endpoint: "https://msg.mobile-gw.com:9000/v1/omni-channel/message",
};
const msg = { to: "+381631234567", text: "Test poruka", trackingData: "cmp:one:rcp:two" };
const fetchMock = vi.fn();
const response = (code = "ACCEPTED") => ({ resultCode: "OK", messages: [{
  destination: { phoneNumber: "381631234567" },
  messageId: "a8e4c54d-13ac-42d8-a1d8-1fee84248d7c", status: { code },
}] });

beforeEach(() => { vi.stubGlobal("fetch", fetchMock); __resetViberConfig(); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); __resetViberConfig(); fetchMock.mockReset(); });

describe("NTH Business Messages contract", () => {
  it("normalizes Serbian local and international numbers and rejects invalid destinations", () => {
    for (const phone of ["0631234567", "+381 63 123-4567", "00381631234567", "381631234567"])
      expect(nthPhoneNumber(phone)).toBe("381631234567");
    for (const phone of ["bot-id", "+41791234567", "381", "3810631234567"])
      expect(() => nthPhoneNumber(phone)).toThrow();
  });
  it("maps rich campaigns into Viber-only delivery without SMS fallback", () => {
    const body = buildNthPayload({ ...msg, imageUrl: "https://example.com/image.jpg", cta: { label: "Pogledaj", url: "https://example.com" } }, cfg.sender);
    expect(body).toMatchObject({ channels: ["VIBER"], destinations: [{ phoneNumber: "381631234567" }], transactionId: msg.trackingData, dlr: false,
      viber: { sender: cfg.sender, ttl: 3600, label: "promotion", buttonCaption: "Pogledaj", image: "https://example.com/image.jpg" } });
    expect(body).not.toHaveProperty("sms");
  });
  it("supports approved transaction templates and rejects promotional media on transactions", () => {
    expect(buildNthPayload({ ...msg, kind: "transaction", template: { id: "approved-id", lang: "sr", parameters: { order_number: "12345" } } }, cfg.sender).viber).toMatchObject({ label: "transaction", template: { id: "approved-id" } });
    expect(() => buildNthPayload({ ...msg, kind: "transaction", cta: { label: "Test", url: "https://example.com" } }, cfg.sender)).toThrow();
    expect(() => buildNthPayload({ ...msg, text: "x".repeat(1001) }, cfg.sender)).toThrow();
    expect(() => buildNthPayload({ ...msg, cta: { label: "x".repeat(31), url: "https://example.com" } }, cfg.sender)).toThrow();
  });
  it("authenticates and accepts only a verified single-recipient acknowledgement", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(response())));
    expect(await dispatchNth(msg, cfg)).toMatchObject({ ok: true, provider: "nth" });
    const [url, request] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(cfg.endpoint);
    expect(request.headers.Authorization).toBe(`Basic ${Buffer.from("test-user:test-password").toString("base64")}`);
    expect(request.signal).toBeInstanceOf(AbortSignal);
    expect(request.redirect).toBe("error");
  });
  it("rejects HTTP failures, logical rejection, malformed response and wrong-recipient response", async () => {
    for (const r of [new Response("Unauthorized", { status: 401 }), new Response(JSON.stringify(response("REJECTED"))), new Response("{}"), new Response(JSON.stringify({ ...response(), messages: [{ ...response().messages[0], destination: { phoneNumber: "381641234567" } }] }))]) {
      fetchMock.mockResolvedValueOnce(r);
      expect(await dispatchNth(msg, cfg)).toMatchObject({ ok: false });
    }
  });
  it("does not retry an ambiguous network write or expose provider errors", async () => {
    fetchMock.mockRejectedValue(new Error("secret or personal data"));
    expect(await dispatchNth(msg, cfg)).toEqual({ ok: false, provider: "nth", error: "nth:ambiguous_network_result_do_not_retry" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("fails closed when provider is disabled, unaccepted, or has placeholder credentials", async () => {
    vi.stubEnv("VIBER_PROVIDER", "none");
    expect(await dispatch(msg)).toMatchObject({ ok: false });
    __resetViberConfig(); vi.stubEnv("VIBER_PROVIDER", "nth"); vi.stubEnv("VIBER_PRODUCTION_ACCEPTED", "false");
    expect(await dispatch(msg)).toMatchObject({ ok: false });
    __resetViberConfig(); vi.stubEnv("VIBER_PRODUCTION_ACCEPTED", "true"); vi.stubEnv("NTH_API_PASSWORD", "GET_FROM_NTH");
    expect(getViberConfig().password).toBeNull();
    expect(await dispatch(msg)).toMatchObject({ ok: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
