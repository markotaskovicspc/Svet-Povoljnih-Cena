import { describe, expect, it } from "vitest";
import {
  isTransferPaid,
  shouldCancelUnpaidTransfer,
  unpaidTransferDeadline,
  unpaidTransferReminderBefore,
} from "@/lib/orders/unpaid-transfer";

const day = 24 * 60 * 60 * 1000;
const now = new Date("2026-11-14T10:00:00Z");
const ago = (days: number) => new Date(now.getTime() - days * day);

describe("unpaid bank-transfer orders", () => {
  it("reminds after three days", () => {
    expect(unpaidTransferReminderBefore(now)).toEqual(ago(3));
  });

  it("cancels only after ten days and three days after the reminder", () => {
    expect(shouldCancelUnpaidTransfer({ createdAt: ago(11), reminderCompletedAt: ago(8), now })).toBe(true);
    expect(shouldCancelUnpaidTransfer({ createdAt: ago(9), reminderCompletedAt: ago(6), now })).toBe(false);
    // Old predračun that only just got its reminder keeps three days to pay.
    expect(shouldCancelUnpaidTransfer({ createdAt: ago(27), reminderCompletedAt: ago(1), now })).toBe(false);
    expect(shouldCancelUnpaidTransfer({ createdAt: ago(27), reminderCompletedAt: null, now })).toBe(false);
  });

  it("shows the later of both deadlines", () => {
    expect(unpaidTransferDeadline(ago(3), now)).toEqual(new Date(ago(3).getTime() + 10 * day));
    expect(unpaidTransferDeadline(ago(27), now)).toEqual(new Date(now.getTime() + 3 * day));
  });

  it("treats paid and authorised payments as paid", () => {
    expect(isTransferPaid(["PENDING"])).toBe(false);
    expect(isTransferPaid(["PENDING", "PAID"])).toBe(true);
    expect(isTransferPaid(["AUTHORIZED"])).toBe(true);
  });
});
