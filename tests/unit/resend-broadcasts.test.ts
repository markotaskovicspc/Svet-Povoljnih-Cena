import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/email/config", () => ({
  getEmailConfig: () => ({
    provider: "resend",
    apiKey: "resend-test-key",
  }),
}));

import {
  addResendContactToSegment,
  cancelResendBroadcast,
  createResendBroadcast,
  createResendSegment,
  getResendBroadcast,
  sendResendBroadcast,
} from "@/lib/email/resend-broadcasts";

describe("Resend broadcast lifecycle", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("creates the segment and broadcast, adds contact, sends, reads and cancels", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ id: "segment-id" }))
      .mockResolvedValueOnce(json({ object: "contact_segment" }))
      .mockResolvedValueOnce(json({ id: "broadcast-id" }))
      .mockResolvedValueOnce(json({ object: "broadcast" }))
      .mockResolvedValueOnce(json({ id: "broadcast-id", status: "sent" }))
      .mockResolvedValueOnce(json({ object: "broadcast" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(createResendSegment("SPC Audit")).resolves.toEqual({ id: "segment-id" });
    await addResendContactToSegment("audit@example.com", "segment-id");
    await expect(
      createResendBroadcast({
        name: "SPC Audit",
        segmentId: "segment-id",
        subject: "Audit",
        previewText: "Preview",
        html: "<p>Audit {{{RESEND_UNSUBSCRIBE_URL}}}</p>",
        text: "Audit {{{RESEND_UNSUBSCRIBE_URL}}}",
        from: "Ponude <ponude@svetpovoljnihcena.rs>",
        replyTo: "podrska@svetpovoljnihcena.rs",
        topicId: "topic-id",
      }),
    ).resolves.toEqual({ id: "broadcast-id" });
    await sendResendBroadcast("broadcast-id");
    await expect(getResendBroadcast("broadcast-id")).resolves.toMatchObject({
      status: "sent",
    });
    await cancelResendBroadcast("broadcast-id");

    expect(fetchMock.mock.calls.map(([url, request]) => [url, request.method])).toEqual([
      ["https://api.resend.com/segments", "POST"],
      ["https://api.resend.com/contacts/audit%40example.com/segments/segment-id", "POST"],
      ["https://api.resend.com/broadcasts", "POST"],
      ["https://api.resend.com/broadcasts/broadcast-id/send", "POST"],
      ["https://api.resend.com/broadcasts/broadcast-id", "GET"],
      ["https://api.resend.com/broadcasts/broadcast-id", "DELETE"],
    ]);
    for (const [, request] of fetchMock.mock.calls) {
      expect(request.headers).toEqual(
        expect.objectContaining({
          "User-Agent": "SvetPovoljnihCena-Broadcasts/1.0",
        }),
      );
    }
    expect(JSON.parse(fetchMock.mock.calls[2]?.[1]?.body as string)).toMatchObject({
      segment_id: "segment-id",
      topic_id: "topic-id",
      reply_to: "podrska@svetpovoljnihcena.rs",
    });
  });
});

function json(body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
