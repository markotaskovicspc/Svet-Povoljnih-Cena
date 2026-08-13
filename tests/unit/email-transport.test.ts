import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const config = vi.hoisted(() => ({
  provider: "resend" as "resend" | "postmark" | "none",
  apiKey: "resend-test-key" as string | null,
}));

vi.mock("@/lib/email/config", () => ({
  getEmailConfig: () => ({
    provider: config.provider,
    apiKey: config.apiKey,
    from: "Svet povoljnih cena <no-reply@svetpovoljnihcena.rs>",
    replyTo: "podrska@svetpovoljnihcena.rs",
  }),
}));

import { dispatch } from "@/lib/email/transport";

describe("Resend transport", () => {
  beforeEach(() => {
    config.provider = "resend";
    config.apiKey = "resend-test-key";
  });

  afterEach(() => {
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
});
