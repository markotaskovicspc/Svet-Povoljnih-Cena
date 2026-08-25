import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  sendCommentNotification: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: { comment: { create: mocks.create } },
}));

vi.mock("@/lib/email/comment-notification", () => ({
  sendCommentNotification: mocks.sendCommentNotification,
}));

import { submitComment } from "@/lib/api/comments";

describe("comment submission", () => {
  beforeEach(() => {
    mocks.create.mockResolvedValue({
      id: "comment-1",
      createdAt: new Date("2026-08-25T10:00:00.000Z"),
    });
    mocks.sendCommentNotification.mockResolvedValue({
      ok: true,
      id: "email-1",
      provider: "resend",
    });
  });

  it("stores the message before notifying the office inbox", async () => {
    const result = await submitComment(
      {
        name: "Test Kupac",
        email: "KUPAC@EXAMPLE.COM",
        subject: "Pitanje",
        body: "Molim vas za odgovor.",
      },
      null,
    );

    expect(result.id).toBe("comment-1");
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ email: "kupac@example.com" }),
      }),
    );
    expect(mocks.sendCommentNotification).toHaveBeenCalledWith({
      id: "comment-1",
      name: "Test Kupac",
      email: "kupac@example.com",
      subject: "Pitanje",
      body: "Molim vas za odgovor.",
    });
    expect(
      mocks.create.mock.invocationCallOrder[0],
    ).toBeLessThan(mocks.sendCommentNotification.mock.invocationCallOrder[0]!);
  });

  it("keeps a stored message successful if email delivery fails", async () => {
    mocks.sendCommentNotification.mockRejectedValue(new Error("provider down"));
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(
      submitComment(
        {
          name: "Test Kupac",
          email: "kupac@example.com",
          body: "Poruka ostaje sačuvana.",
        },
        null,
      ),
    ).resolves.toMatchObject({ id: "comment-1" });
    expect(error).toHaveBeenCalledOnce();
    error.mockRestore();
  });
});
