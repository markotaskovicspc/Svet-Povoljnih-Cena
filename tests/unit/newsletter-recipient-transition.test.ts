import { describe, expect, it } from "vitest";
import {
  newsletterRecipientTransition,
  requiresSecondApprover,
} from "@/lib/newsletter/campaigns";

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

  it("ignores a replay of the same provider state", () => {
    expect(newsletterRecipientTransition("email.opened", "OPENED", now)).toBeNull();
    expect(newsletterRecipientTransition("email.bounced", "BOUNCED", now)).toBeNull();
  });

  it("allows terminal provider outcomes from non-terminal states", () => {
    expect(newsletterRecipientTransition("email.bounced", "SENT", now)?.status).toBe("BOUNCED");
    expect(newsletterRecipientTransition("email.complained", "DELIVERED", now)?.status).toBe("COMPLAINED");
  });

  it("requires a different approver when the final audience crosses the threshold", () => {
    expect(requiresSecondApprover({ createdById: "admin-1", approvedById: "admin-1" }, 1_000)).toBe(true);
    expect(requiresSecondApprover({ createdById: "admin-1", approvedById: "admin-2" }, 1_000)).toBe(false);
    expect(requiresSecondApprover({ createdById: "admin-1", approvedById: "admin-1" }, 999)).toBe(false);
  });
});
