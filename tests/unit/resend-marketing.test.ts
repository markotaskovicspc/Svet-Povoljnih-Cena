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

  it("creates an opted-in contact with topic, segment and properties", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("{}", {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      syncResendContact({
        email: " AUDIT@EXAMPLE.COM ",
        firstName: "Test",
        lastName: "Kontakt",
        unsubscribed: false,
        promotionalAudience: true,
        source: "audit",
        userId: "user-audit",
        properties: { segment_hint: "registered", empty: null },
      }),
    ).resolves.toEqual({ ok: true });

    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/contacts");
    expect(request.headers).toEqual(
      expect.objectContaining({
        Authorization: "Bearer resend-test-key",
        "User-Agent": "SvetPovoljnihCena-Marketing/1.0",
      }),
    );
    expect(JSON.parse(request.body as string)).toEqual(
      expect.objectContaining({
        email: "audit@example.com",
        unsubscribed: false,
        segments: [{ id: "segment-newsletter" }],
        topics: [{ id: "topic-promotions", subscription: "opt_in" }],
        properties: expect.objectContaining({
          customer_id: "user-audit",
          consent_source: "audit",
          preferred_locale: "sr-Latn",
          segment_hint: "registered",
        }),
      }),
    );
  });

  it("falls back without unknown properties while preserving consent fields", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ message: "One or more properties do not exist" }),
          { status: 422, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response("{}", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      syncResendContact({
        email: "audit@example.com",
        unsubscribed: false,
        promotionalAudience: true,
        source: "audit",
        properties: { property_not_in_resend: "value" },
      }),
    ).resolves.toEqual({ ok: true });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const fallback = JSON.parse(fetchMock.mock.calls[1]?.[1]?.body as string);
    expect(fallback).not.toHaveProperty("properties");
    expect(fallback).toMatchObject({
      unsubscribed: false,
      segments: [{ id: "segment-newsletter" }],
      topics: [{ id: "topic-promotions", subscription: "opt_in" }],
    });
  });

  it("updates existing suppressed contacts and opts them out of the topic", async () => {
    mocks.suppressed.mockResolvedValue(true);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: "Contact already exists" }), {
          status: 409,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response("{}", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response("{}", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      syncResendContact({
        email: "audit@example.com",
        unsubscribed: false,
        promotionalAudience: true,
        source: "audit",
      }),
    ).resolves.toEqual({ ok: true });

    expect(fetchMock.mock.calls.map(([url, request]) => [url, request.method])).toEqual([
      ["https://api.resend.com/contacts", "POST"],
      ["https://api.resend.com/contacts/audit%40example.com", "PATCH"],
      ["https://api.resend.com/contacts/audit%40example.com/topics", "PATCH"],
    ]);
    const update = JSON.parse(fetchMock.mock.calls[1]?.[1]?.body as string);
    expect(update).toMatchObject({
      unsubscribed: true,
      topics: [{ id: "topic-promotions", subscription: "opt_out" }],
    });
  });
});
