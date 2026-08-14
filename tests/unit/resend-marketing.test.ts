import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  suppressed: vi.fn(),
}));

vi.mock("@/lib/email/config", () => ({
  getEmailConfig: () => ({
    provider: "resend",
    apiKey: "resend-test-key",
    promotionsTopicId: "topic-promotions",
    newsletterSegmentId: "segment-newsletter",
  }),
}));

vi.mock("@/lib/email/tracking", () => ({
  isEmailSuppressed: mocks.suppressed,
}));

vi.mock("@/lib/db", () => ({ db: {} }));

import { syncResendContact } from "@/lib/email/resend-marketing";

describe("Resend contact synchronization", () => {
  beforeEach(() => {
    mocks.suppressed.mockResolvedValue(false);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("creates a missing contact with the documented REST field names and no internal metadata", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ message: "not found" }, 404))
      .mockResolvedValueOnce(jsonResponse({ id: "contact-1" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(syncResendContact({
      email: " AUDIT@EXAMPLE.COM ",
      firstName: "Test",
      lastName: "Kontakt",
      unsubscribed: false,
      promotionalAudience: true,
      subscriptionIntent: "grant",
      source: "audit",
    })).resolves.toEqual({ ok: true });

    expect(fetchMock.mock.calls.map(([url, request]) => [url, request.method])).toEqual([
      ["https://api.resend.com/contacts/audit%40example.com", "GET"],
      ["https://api.resend.com/contacts", "POST"],
    ]);
    const create = JSON.parse(fetchMock.mock.calls[1]?.[1]?.body as string);
    expect(create).toEqual({
      email: "audit@example.com",
      first_name: "Test",
      last_name: "Kontakt",
      unsubscribed: false,
      segments: [{ id: "segment-newsletter" }],
      topics: [{ id: "topic-promotions", subscription: "opt_in" }],
    });
    expect(create).not.toHaveProperty("properties");
  });

  it("preserves an existing opted-in provider preference without writing it again", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ email: "audit@example.com", unsubscribed: false }))
      .mockResolvedValueOnce(jsonResponse({
        object: "list",
        data: [{ id: "topic-promotions", subscription: "opt_in" }],
      }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(syncResendContact({
      email: "audit@example.com",
      unsubscribed: false,
      promotionalAudience: true,
      subscriptionIntent: "preserve",
      source: "campaign",
    })).resolves.toEqual({ ok: true });

    expect(fetchMock.mock.calls.map(([url, request]) => [url, request.method])).toEqual([
      ["https://api.resend.com/contacts/audit%40example.com", "GET"],
      ["https://api.resend.com/contacts/audit%40example.com/topics", "GET"],
    ]);
  });

  it("reports a provider topic opt-out instead of silently re-enabling it", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ email: "audit@example.com", unsubscribed: false }))
      .mockResolvedValueOnce(jsonResponse({
        object: "list",
        data: [{ id: "topic-promotions", subscription: "opt_out" }],
      }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(syncResendContact({
      email: "audit@example.com",
      unsubscribed: false,
      promotionalAudience: true,
      subscriptionIntent: "preserve",
      source: "campaign",
    })).resolves.toEqual({ ok: true, providerOptedOut: true });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("re-enables an existing contact only for an explicit grant", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ email: "audit@example.com", unsubscribed: true }))
      .mockResolvedValueOnce(jsonResponse({}))
      .mockResolvedValueOnce(jsonResponse({}));
    vi.stubGlobal("fetch", fetchMock);

    await expect(syncResendContact({
      email: "audit@example.com",
      unsubscribed: false,
      promotionalAudience: true,
      subscriptionIntent: "grant",
      source: "confirmed-opt-in",
    })).resolves.toEqual({ ok: true });

    expect(JSON.parse(fetchMock.mock.calls[1]?.[1]?.body as string)).toEqual({
      unsubscribed: false,
    });
    expect(JSON.parse(fetchMock.mock.calls[2]?.[1]?.body as string)).toEqual([
      { id: "topic-promotions", subscription: "opt_in" },
    ]);
  });

  it("forces a local suppression to global and topic opt-out", async () => {
    mocks.suppressed.mockResolvedValue(true);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ email: "audit@example.com", unsubscribed: false }))
      .mockResolvedValueOnce(jsonResponse({}))
      .mockResolvedValueOnce(jsonResponse({}));
    vi.stubGlobal("fetch", fetchMock);

    await expect(syncResendContact({
      email: "audit@example.com",
      unsubscribed: false,
      promotionalAudience: true,
      subscriptionIntent: "preserve",
      source: "audit",
    })).resolves.toEqual({ ok: true });

    expect(JSON.parse(fetchMock.mock.calls[1]?.[1]?.body as string)).toEqual({
      unsubscribed: true,
    });
    expect(JSON.parse(fetchMock.mock.calls[2]?.[1]?.body as string)).toEqual([
      { id: "topic-promotions", subscription: "opt_out" },
    ]);
  });
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
