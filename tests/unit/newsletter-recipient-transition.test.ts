import { describe, expect, it } from "vitest";
import { newsletterRecipientTransition } from "@/lib/newsletter/campaigns";

describe("newsletter provider event transitions", () => {
  const now = new Date("2026-07-29T10:00:00Z");

  it("moves delivery events forward and attaches their timestamps", () => {
    expect(newsletterRecipientTransition("email.opened", "DELIVERED", now)).toEqual({
      status: "OPENED",
      timestamp: { openedAt: now },
    });
    expect(newsletterRecipientTransition("email.clicked", "OPENED", now)?.status).toBe("CLICKED");
  });

  it("ignores out-of-order downgrades", () => {
    expect(newsletterRecipientTransition("email.delivered", "CLICKED", now)).toBeNull();
    expect(newsletterRecipientTransition("email.opened", "BOUNCED", now)).toBeNull();
    expect(newsletterRecipientTransition("email.sent", "UNSUBSCRIBED", now)).toBeNull();
  });

  it("allows terminal provider outcomes from non-terminal states", () => {
    expect(newsletterRecipientTransition("email.bounced", "SENT", now)?.status).toBe("BOUNCED");
    expect(newsletterRecipientTransition("email.complained", "DELIVERED", now)?.status).toBe("COMPLAINED");
  });
});
