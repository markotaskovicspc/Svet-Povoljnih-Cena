import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  trackedDispatch: vi.fn(),
}));

vi.mock("@/lib/email/config", () => ({
  getEmailConfig: () => ({
    commentsNotificationTo: "office@svetpovoljnihcena.rs",
    baseUrl: "https://www.svetpovoljnihcena.rs/",
  }),
}));

vi.mock("@/lib/email/tracking", () => ({
  trackedDispatch: mocks.trackedDispatch,
}));

import { sendCommentNotification } from "@/lib/email/comment-notification";

describe("contact-form email notification", () => {
  beforeEach(() => {
    mocks.trackedDispatch.mockResolvedValue({
      ok: true,
      id: "email-1",
      provider: "resend",
    });
  });

  it("notifies the office inbox and makes replies go to the customer", async () => {
    await sendCommentNotification({
      id: "comment-1",
      name: "Test Kupac <script>",
      email: "kupac@example.com",
      subject: "Pitanje & predlog",
      body: "Prvi red\n<img src=x onerror=alert(1)>",
    });

    expect(mocks.trackedDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "comment_notification",
        to: "office@svetpovoljnihcena.rs",
        replyTo: "kupac@example.com",
        subject: "Nova poruka sa sajta — Pitanje & predlog",
        idempotencyKey: "comment-notification:comment-1",
        metadata: { commentId: "comment-1" },
      }),
    );
    const message = mocks.trackedDispatch.mock.calls[0]?.[0];
    expect(message.html).toContain("Test Kupac &lt;script&gt;");
    expect(message.html).toContain(
      "Prvi red<br />&lt;img src=x onerror=alert(1)&gt;",
    );
    expect(message.html).toContain(
      'href="https://www.svetpovoljnihcena.rs/admin/komentari"',
    );
    expect(message.html).not.toContain("<script>");
  });
});
