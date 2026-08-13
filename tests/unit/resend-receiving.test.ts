import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  eventFindUnique: vi.fn(),
  eventUpdate: vi.fn(),
  eventFindMany: vi.fn(),
  normalizeInbound: vi.fn(),
  classifyInboundMessage: vi.fn(),
  handleInboundMessage: vi.fn(),
  upload: vi.fn(),
  createSignedUrls: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    emailProviderEvent: {
      findUnique: mocks.eventFindUnique,
      update: mocks.eventUpdate,
      findMany: mocks.eventFindMany,
    },
  },
}));

vi.mock("@/lib/env", () => ({
  envValue: (name: string) =>
    ({
      RESEND_API_KEY: "resend-test-key",
      NEXT_PUBLIC_SUPABASE_URL: "https://storage.example.test",
      SUPABASE_SERVICE_ROLE_KEY: "service-role-test",
    })[name] ?? null,
}));

vi.mock("@/lib/monitoring", () => ({ redactText: (value: string) => value }));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    storage: {
      from: () => ({
        upload: mocks.upload,
        createSignedUrls: mocks.createSignedUrls,
        remove: mocks.remove,
      }),
    },
  }),
}));

vi.mock("@/lib/email/inbound", () => ({
  normalizeInbound: mocks.normalizeInbound,
  classifyInboundMessage: mocks.classifyInboundMessage,
  handleInboundMessage: mocks.handleInboundMessage,
}));

import {
  inboundEmailIdFromSubject,
  loadInboundAttachmentLinks,
  processResendInboundEmail,
  removeInboundAttachments,
} from "@/lib/email/resend-receiving";

describe("Resend Receiving processing", () => {
  beforeEach(() => {
    mocks.eventFindUnique.mockResolvedValue({
      id: "event-row-1",
      payload: { type: "email.received" },
    });
    mocks.eventUpdate.mockResolvedValue({ id: "event-row-1" });
    mocks.normalizeInbound.mockReturnValue({
      from: "kupac@example.com",
      fromName: "Kupac",
      to: ["reklamacije@svetpovoljnihcena.rs"],
      subject: "Reklamacija",
      text: "Oštećen proizvod",
      messageId: "received-1",
      attachments: [
        {
          id: "attachment-1",
          filename: "dokaz.pdf",
          contentType: "application/pdf",
          contentDisposition: "attachment",
          size: 9,
        },
      ],
    });
    mocks.classifyInboundMessage.mockReturnValue("reclamation");
    mocks.handleInboundMessage.mockResolvedValue({
      ok: true,
      route: "reclamation",
      commentId: "comment-1",
    });
    mocks.upload.mockResolvedValue({ error: null });
    mocks.createSignedUrls.mockResolvedValue({ data: [], error: null });
    mocks.remove.mockResolvedValue({ error: null });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("retrieves the full message, stores a verified private attachment and records success", async () => {
    const pdf = new TextEncoder().encode("%PDF-test");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          id: "received-1",
          from: "kupac@example.com",
          to: ["reklamacije@svetpovoljnihcena.rs"],
          subject: "Reklamacija",
          text: "Oštećen proizvod",
          attachments: [],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          id: "attachment-1",
          filename: "dokaz.pdf",
          size: pdf.byteLength,
          content_type: "application/pdf",
          download_url: "https://inbound-cdn.resend.com/signed-pdf",
        }),
      )
      .mockResolvedValueOnce(
        Object.defineProperty(new Response(pdf, {
          status: 200,
          headers: { "content-length": String(pdf.byteLength) },
        }), "url", { value: "https://inbound-cdn.resend.com/signed-pdf" }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      processResendInboundEmail({ emailId: "received-1", eventId: "event-1" }),
    ).resolves.toEqual({
      ok: true,
      route: "reclamation",
      commentId: "comment-1",
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://api.resend.com/emails/receiving/received-1?html_format=cid",
    );
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toEqual(
      expect.objectContaining({
        Authorization: "Bearer resend-test-key",
        "User-Agent": "SvetPovoljnihCena-Receiving/1.0",
      }),
    );
    expect(mocks.upload).toHaveBeenCalledWith(
      "inbound-email/received-1/attachment-1/dokaz.pdf",
      expect.any(Uint8Array),
      expect.objectContaining({
        contentType: "application/pdf",
        upsert: true,
      }),
    );
    expect(mocks.eventUpdate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: {
          payload: expect.objectContaining({
            inboundProcessing: expect.objectContaining({
              status: "PROCESSED",
              route: "reclamation",
              commentId: "comment-1",
              attachments: [
                expect.objectContaining({
                  key: "inbound-email/received-1/attachment-1/dokaz.pdf",
                }),
              ],
            }),
          }),
        },
      }),
    );
  });

  it("skips unsupported attachments without downloading them", async () => {
    mocks.normalizeInbound.mockReturnValueOnce({
      from: "kupac@example.com",
      fromName: null,
      to: ["reklamacije@svetpovoljnihcena.rs"],
      subject: "Nedozvoljen prilog",
      text: "Tekst postoji",
      messageId: "received-2",
      attachments: [
        {
          id: "attachment-exe",
          filename: "program.exe",
          contentType: "application/octet-stream",
          contentDisposition: "attachment",
          size: 100,
        },
      ],
    });
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        id: "received-2",
        from: "kupac@example.com",
        to: ["reklamacije@svetpovoljnihcena.rs"],
        subject: "Nedozvoljen prilog",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await processResendInboundEmail({ emailId: "received-2", eventId: "event-2" });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.eventUpdate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: {
          payload: expect.objectContaining({
            inboundProcessing: expect.objectContaining({
              skippedAttachments: [
                expect.objectContaining({ reason: "unsupported_type" }),
              ],
            }),
          }),
        },
      }),
    );
  });

  it("records provider failures and rethrows so the durable job can retry", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({ message: "temporary outage" }, 503),
      ),
    );

    await expect(
      processResendInboundEmail({ emailId: "received-3", eventId: "event-3" }),
    ).rejects.toThrow("resend_inbound_api:503:temporary outage");
    expect(mocks.eventUpdate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: {
          payload: expect.objectContaining({
            inboundProcessing: expect.objectContaining({ status: "FAILED" }),
          }),
        },
      }),
    );
  });

  it("signs stored attachment keys for admin and removes them on comment deletion", async () => {
    const key = "inbound-email/received-4/attachment-1/dokaz.pdf";
    mocks.eventFindMany.mockResolvedValue([
      {
        providerMessageId: "received-4",
        payload: {
          inboundProcessing: {
            attachments: [
              {
                id: "attachment-1",
                filename: "dokaz.pdf",
                contentType: "application/pdf",
                size: 1200,
                key,
              },
            ],
          },
        },
      },
    ]);
    mocks.createSignedUrls.mockResolvedValue({
      data: [{ path: key, signedUrl: "https://storage.example.test/signed" }],
      error: null,
    });

    const links = await loadInboundAttachmentLinks(["received-4"]);
    expect(links.get("received-4")).toEqual([
      expect.objectContaining({
        filename: "dokaz.pdf",
        signedUrl: "https://storage.example.test/signed",
      }),
    ]);
    expect(mocks.createSignedUrls).toHaveBeenCalledWith([key], 15 * 60, {
      download: true,
    });

    await removeInboundAttachments("received-4");
    expect(mocks.remove).toHaveBeenCalledWith([key]);
    expect(inboundEmailIdFromSubject("[in:received-4] [komentar] Tema")).toBe(
      "received-4",
    );
  });
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
