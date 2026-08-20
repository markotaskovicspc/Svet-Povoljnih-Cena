import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  afterCallbacks: [] as Array<() => Promise<void> | void>,
  recordProviderEvent: vi.fn(),
  recordNewsletterProviderEvent: vi.fn(),
  enqueueBackgroundJob: vi.fn(),
  processBackgroundJob: vi.fn(),
  withdrawMarketingEmail: vi.fn(),
}));

vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return {
    ...actual,
    after: (callback: () => Promise<void> | void) => {
      mocks.afterCallbacks.push(callback);
    },
  };
});

vi.mock("@/lib/email", () => ({
  getEmailConfig: () => ({ resendWebhookSecret: "webhook-test-secret" }),
  recordProviderEvent: mocks.recordProviderEvent,
}));

vi.mock("@/lib/background-jobs", () => ({
  enqueueBackgroundJob: mocks.enqueueBackgroundJob,
  processBackgroundJob: mocks.processBackgroundJob,
}));

vi.mock("@/lib/newsletter/campaigns", () => ({
  recordNewsletterProviderEvent: mocks.recordNewsletterProviderEvent,
}));

vi.mock("@/lib/newsletter/contacts", () => ({
  withdrawMarketingEmail: mocks.withdrawMarketingEmail,
}));

import { POST } from "@/app/api/email/events/route";

describe("Resend events route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.afterCallbacks.length = 0;
    mocks.recordProviderEvent.mockResolvedValue({ ok: true, duplicate: false });
    mocks.recordNewsletterProviderEvent.mockResolvedValue({ matched: false });
    mocks.enqueueBackgroundJob.mockResolvedValue({ id: "job-1", status: "QUEUED" });
    mocks.processBackgroundJob.mockResolvedValue({ claimed: true, ok: true });
  });

  it("queues received email processing and starts it after the webhook response", async () => {
    const payload = {
      type: "email.received",
      data: { email_id: "received-1", to: ["reklamacije@example.com"] },
    };
    const response = await POST(signedRequest(payload, "event-1"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      duplicate: false,
      newsletterMatched: false,
      inbound: { queued: true, jobId: "job-1", jobStatus: "QUEUED" },
    });
    expect(mocks.enqueueBackgroundJob).toHaveBeenCalledWith({
      kind: "RESEND_INBOUND_EMAIL",
      payload: { emailId: "received-1", eventId: "event-1" },
      idempotencyKey: "resend-inbound:received-1",
      maxAttempts: 8,
    });
    expect(mocks.processBackgroundJob).not.toHaveBeenCalled();
    expect(mocks.afterCallbacks).toHaveLength(1);
    await mocks.afterCallbacks[0]?.();
    expect(mocks.processBackgroundJob).toHaveBeenCalledWith("job-1");
  });

  it("records but does not queue a malformed received event", async () => {
    const response = await POST(
      signedRequest({ type: "email.received", data: {} }, "event-missing-id"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        inbound: { queued: false, reason: "missing_email_id" },
      }),
    );
    expect(mocks.enqueueBackgroundJob).not.toHaveBeenCalled();
    expect(mocks.afterCallbacks).toHaveLength(0);
  });

  it("reconciles topic-only preference updates in the background", async () => {
    const response = await POST(signedRequest({
      type: "contact.updated",
      data: {
        email: "subscriber@example.com",
        unsubscribed: false,
      },
    }, "event-contact-topic"));

    expect(response.status).toBe(200);
    expect(mocks.enqueueBackgroundJob).toHaveBeenCalledWith({
      kind: "NEWSLETTER_SYNC",
      payload: {
        email: "subscriber@example.com",
        subscriptionIntent: "preserve",
      },
      idempotencyKey: "newsletter-provider-reconcile:event-contact-topic",
      maxAttempts: 8,
    });
    expect(mocks.withdrawMarketingEmail).not.toHaveBeenCalled();
    expect(mocks.afterCallbacks).toHaveLength(1);
    await mocks.afterCallbacks[0]?.();
    expect(mocks.processBackgroundJob).toHaveBeenCalledWith("job-1");
  });

  it("withdraws a globally unsubscribed contact immediately", async () => {
    const response = await POST(signedRequest({
      type: "contact.updated",
      data: {
        email: "subscriber@example.com",
        unsubscribed: true,
      },
    }, "event-contact-global"));

    expect(response.status).toBe(200);
    expect(mocks.withdrawMarketingEmail).toHaveBeenCalledWith(
      "subscriber@example.com",
      "resend-preference-page",
    );
    expect(mocks.enqueueBackgroundJob).not.toHaveBeenCalled();
  });

  it("returns immediately for a replayed event without repeating side effects", async () => {
    mocks.recordProviderEvent.mockResolvedValue({ ok: true, duplicate: true });
    const response = await POST(signedRequest({
      type: "email.received",
      data: { email_id: "received-replay" },
    }, "event-replay"));

    await expect(response.json()).resolves.toEqual({
      ok: true,
      duplicate: true,
      newsletterMatched: false,
      inbound: null,
    });
    expect(mocks.recordNewsletterProviderEvent).not.toHaveBeenCalled();
    expect(mocks.enqueueBackgroundJob).not.toHaveBeenCalled();
  });

  it("rejects an invalid Svix signature before any database write", async () => {
    const request = new Request("https://example.test/api/email/events", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "svix-id": "event-invalid",
        "svix-timestamp": String(Math.floor(Date.now() / 1000)),
        "svix-signature": "v1,invalid",
      },
      body: JSON.stringify({ type: "email.received", data: {} }),
    });

    const response = await POST(request);
    expect(response.status).toBe(401);
    expect(mocks.recordProviderEvent).not.toHaveBeenCalled();
  });
});

function signedRequest(payload: unknown, eventId: string) {
  const body = JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac("sha256", "webhook-test-secret")
    .update(`${eventId}.${timestamp}.${body}`)
    .digest("base64");
  return new Request("https://example.test/api/email/events", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "svix-id": eventId,
      "svix-timestamp": timestamp,
      "svix-signature": `v1,${signature}`,
    },
    body,
  });
}
