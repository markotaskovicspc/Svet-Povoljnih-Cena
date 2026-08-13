import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  create: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    comment: {
      findFirst: mocks.findFirst,
      create: mocks.create,
    },
  },
}));

vi.mock("@/lib/email/config", () => ({
  getEmailConfig: () => ({
    reclamationsInbox: "reklamacije@svetpovoljnihcena.rs",
    commentsInbox: "komentar@svetpovoljnihcena.rs",
  }),
}));

import {
  classifyInboundMessage,
  handleInboundMessage,
  normalizeInbound,
} from "@/lib/email/inbound";

describe("inbound email normalization and routing", () => {
  beforeEach(() => {
    mocks.findFirst.mockResolvedValue(null);
    mocks.create.mockResolvedValue({ id: "comment-1" });
  });

  it("normalizes a Resend received email and includes forwarded recipients", () => {
    const message = normalizeInbound({
      id: "received-1",
      from: "Kupac <kupac@example.com>",
      to: ["inbox@resend.app"],
      received_for: ["reklamacije@svetpovoljnihcena.rs"],
      subject: "Reklamacija",
      text: "Oštećen proizvod",
      message_id: "<mail-1@example.com>",
      attachments: [
        {
          id: "attachment-1",
          filename: "dokaz.pdf",
          content_type: "application/pdf",
          content_disposition: "attachment",
          size: 1234,
        },
      ],
    });

    expect(message).toEqual({
      from: "kupac@example.com",
      fromName: "Kupac",
      to: ["inbox@resend.app", "reklamacije@svetpovoljnihcena.rs"],
      subject: "Reklamacija",
      text: "Oštećen proizvod",
      messageId: "received-1",
      attachments: [
        {
          id: "attachment-1",
          filename: "dokaz.pdf",
          contentType: "application/pdf",
          contentDisposition: "attachment",
          size: 1234,
        },
      ],
    });
    expect(classifyInboundMessage(message!)).toBe("reclamation");
  });

  it("uses sanitized HTML text when a plain-text body is absent", () => {
    const message = normalizeInbound({
      id: "received-2",
      from: "kupac@example.com",
      to: "komentar@svetpovoljnihcena.rs",
      subject: "Utisak",
      html: "<style>body{display:none}</style><p>Odlično &amp; brzo</p><script>alert(1)</script>",
    });

    expect(message?.text).toBe("Odlično & brzo");
    expect(message?.attachments).toEqual([]);
    expect(classifyInboundMessage(message!)).toBe("comment");
  });

  it("accepts receiving-only subdomain aliases without accepting lookalike domains", () => {
    expect(
      classifyInboundMessage({
        to: ["reklamacije@inbound.svetpovoljnihcena.rs"],
      }),
    ).toBe("reclamation");
    expect(
      classifyInboundMessage({
        to: ["komentar@inbound.svetpovoljnihcena.rs"],
      }),
    ).toBe("comment");
    expect(
      classifyInboundMessage({
        to: ["reklamacije@svetpovoljnihcena.rs.example.com"],
      }),
    ).toBeNull();
    expect(
      classifyInboundMessage({
        to: ["drugo@inbound.svetpovoljnihcena.rs"],
      }),
    ).toBeNull();
  });

  it("creates an attachment-only reclamation with a safe fallback body", async () => {
    const result = await handleInboundMessage({
      from: "kupac@example.com",
      fromName: null,
      to: ["reklamacije@svetpovoljnihcena.rs"],
      subject: "Fotografija",
      text: "",
      messageId: "received-3",
      attachments: [
        {
          id: "attachment-1",
          filename: "slika.jpg",
          contentType: "image/jpeg",
          contentDisposition: "attachment",
          size: 100,
        },
      ],
    });

    expect(result).toEqual({
      ok: true,
      route: "reclamation",
      commentId: "comment-1",
    });
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          subject: "[in:received-3] [reklamacija] Fotografija",
          body: "Poruka nema tekst; pogledajte priloge.",
        }),
      }),
    );
  });

  it("is idempotent by provider email id", async () => {
    mocks.findFirst.mockResolvedValue({ id: "existing-comment" });
    const result = await handleInboundMessage({
      from: "kupac@example.com",
      fromName: null,
      to: ["komentar@svetpovoljnihcena.rs"],
      subject: "Duplikat",
      text: "Ista poruka",
      messageId: "received-4",
      attachments: [],
    });

    expect(result).toEqual({
      ok: true,
      route: "comment",
      commentId: "existing-comment",
    });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("ignores unknown recipients and truly empty messages", async () => {
    await expect(
      handleInboundMessage({
        from: "kupac@example.com",
        fromName: null,
        to: ["drugo@svetpovoljnihcena.rs"],
        subject: "Drugo",
        text: "Poruka",
        messageId: "received-5",
        attachments: [],
      }),
    ).resolves.toEqual({ ok: false, reason: "no_match" });
    await expect(
      handleInboundMessage({
        from: "kupac@example.com",
        fromName: null,
        to: ["komentar@svetpovoljnihcena.rs"],
        subject: "Prazno",
        text: "   ",
        messageId: "received-6",
        attachments: [],
      }),
    ).resolves.toEqual({ ok: false, reason: "empty" });
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
