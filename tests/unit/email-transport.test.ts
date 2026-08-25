import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SendEmailCommand } from "@aws-sdk/client-sesv2";

const config = vi.hoisted(() => ({
  provider: "resend" as "ses" | "resend" | "postmark" | "none",
  apiKey: "resend-test-key" as string | null,
}));

vi.mock("@/lib/email/config", () => ({
  getEmailConfig: () => ({
    provider: config.provider,
    apiKey: config.apiKey,
    sesRegion: "eu-central-1",
    sesConfigurationSet: "spc-production",
    sesCredentialsConfigured: true,
    from: "Svet povoljnih cena <no-reply@svetpovoljnihcena.rs>",
    replyTo: "podrska@svetpovoljnihcena.rs",
  }),
}));

import { dispatch } from "@/lib/email/transport";
import { __setSesClientForTests } from "@/lib/email/ses";

describe("Resend transport", () => {
  beforeEach(() => {
    config.provider = "resend";
    config.apiKey = "resend-test-key";
  });

  afterEach(() => {
    __setSesClientForTests(null);
    vi.unstubAllGlobals();
  });

  it("sends the complete Resend payload with auth, user agent and idempotency", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "email-id" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      dispatch({
        from: "Ponude <ponude@svetpovoljnihcena.rs>",
        to: ["delivered@resend.dev"],
        subject: "Kontrolisani test",
        html: "<p>Test</p>",
        text: "Test",
        bcc: "audit@svetpovoljnihcena.rs",
        cc: "delivered@resend.dev",
        replyTo: "odgovor@svetpovoljnihcena.rs",
        attachments: [
          {
            filename: "audit.txt",
            content: Buffer.from("audit").toString("base64"),
            contentType: "text/plain",
          },
        ],
        tags: { kind: "audit" },
        idempotencyKey: "resend-audit-idempotency",
      }),
    ).resolves.toEqual({ ok: true, id: "email-id", provider: "resend" });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer resend-test-key",
          "Content-Type": "application/json",
          "User-Agent": "SvetPovoljnihCena-Email/1.0",
          "Idempotency-Key": "resend-audit-idempotency",
        }),
      }),
    );
    const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string);
    expect(body).toEqual(
      expect.objectContaining({
        from: "Ponude <ponude@svetpovoljnihcena.rs>",
        to: ["delivered@resend.dev"],
        bcc: ["audit@svetpovoljnihcena.rs"],
        cc: ["delivered@resend.dev"],
        reply_to: "odgovor@svetpovoljnihcena.rs",
        tags: [{ name: "kind", value: "audit" }],
        attachments: [
          expect.objectContaining({
            filename: "audit.txt",
            content_type: "text/plain",
          }),
        ],
      }),
    );
  });

  it("surfaces provider status and message without throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ message: "validation failed" }), {
          status: 422,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    await expect(
      dispatch({
        to: "delivered@resend.dev",
        subject: "Test",
        html: "<p>Test</p>",
      }),
    ).resolves.toEqual({
      ok: false,
      error: "resend:422 validation failed",
      provider: "resend",
    });
  });

  it("uses the no-op provider when Resend credentials are unavailable", async () => {
    config.provider = "none";
    config.apiKey = null;
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

    const result = await dispatch({
      to: "delivered@resend.dev",
      subject: "Test",
      html: "<p>Test</p>",
    });

    expect(result).toMatchObject({ ok: true, provider: "none" });
    expect(info).toHaveBeenCalledOnce();
    info.mockRestore();
  });

  it("sends SES v2 messages with UTF-8 content, attachments and metadata", async () => {
    config.provider = "ses";
    config.apiKey = null;
    const send = vi.fn().mockResolvedValue({ MessageId: "ses-message-id" });
    __setSesClientForTests({ send });

    await expect(
      dispatch({
        from: "Ponude <ponude@svetpovoljnihcena.rs>",
        to: "kupac@example.com",
        subject: "Potvrda porudžbine",
        html: "<p>Hvala</p>",
        text: "Hvala",
        replyTo: "office@svetpovoljnihcena.rs",
        attachments: [
          {
            filename: "racun.pdf",
            content: Buffer.from("pdf-audit").toString("base64"),
            contentType: "application/pdf",
          },
        ],
        tags: { kind: "order_confirmation" },
        idempotencyKey: "order:123:confirmation",
      }),
    ).resolves.toEqual({ ok: true, id: "ses-message-id", provider: "ses" });

    expect(send).toHaveBeenCalledOnce();
    const command = send.mock.calls[0]?.[0];
    expect(command).toBeInstanceOf(SendEmailCommand);
    expect(command.input).toMatchObject({
      FromEmailAddress: "Ponude <ponude@svetpovoljnihcena.rs>",
      Destination: { ToAddresses: ["kupac@example.com"] },
      ReplyToAddresses: ["office@svetpovoljnihcena.rs"],
      ConfigurationSetName: "spc-production",
      Content: {
        Simple: {
          Subject: { Data: "Potvrda porudžbine", Charset: "UTF-8" },
          Attachments: [
            expect.objectContaining({
              FileName: "racun.pdf",
              ContentType: "application/pdf",
            }),
          ],
        },
      },
      EmailTags: expect.arrayContaining([
        { Name: "kind", Value: "order_confirmation" },
        expect.objectContaining({ Name: "idempotency" }),
      ]),
    });
  });

  it("normalizes SES throttling errors without throwing or leaking credentials", async () => {
    config.provider = "ses";
    config.apiKey = null;
    const error = Object.assign(new Error("Maximum sending rate exceeded"), {
      name: "ThrottlingException",
      $metadata: { httpStatusCode: 429, requestId: "aws-request-id" },
      $retryable: {},
    });
    __setSesClientForTests({ send: vi.fn().mockRejectedValue(error) });

    const result = await dispatch({
      to: "kupac@example.com",
      subject: "Test",
      html: "<p>Test</p>",
    });

    expect(result).toEqual({
      ok: false,
      error: expect.stringContaining(
        "ses:ThrottlingException status=429 requestId=aws-request-id retryable=true",
      ),
      provider: "ses",
    });
  });
});
