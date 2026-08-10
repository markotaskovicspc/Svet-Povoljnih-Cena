import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  backgroundJobs: vi.fn(),
  emails: vi.fn(),
  fiscalDocuments: vi.fn(),
  refunds: vi.fn(),
  shipments: vi.fn(),
  admins: vi.fn(),
  setting: vi.fn(),
  upsertSetting: vi.fn(),
  trackedDispatch: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    backgroundJob: { findMany: mocks.backgroundJobs },
    emailMessage: { findMany: mocks.emails },
    fiscalDocument: { findMany: mocks.fiscalDocuments },
    paymentRefund: { findMany: mocks.refunds },
    shipment: { findMany: mocks.shipments },
    adminUser: { findMany: mocks.admins },
    adminSetting: {
      findUnique: mocks.setting,
      upsert: mocks.upsertSetting,
    },
  },
}));

vi.mock("@/lib/email/tracking", () => ({
  trackedDispatch: mocks.trackedDispatch,
}));

import {
  processUrgentAdminAlerts,
  URGENT_ADMIN_ALERT_RECIPIENTS_SETTING_KEY,
  URGENT_ADMIN_ALERT_SETTING_KEY,
} from "@/lib/email/admin-alerts";

describe("urgent SUPER admin email alerts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.backgroundJobs.mockResolvedValue([]);
    mocks.emails.mockResolvedValue([]);
    mocks.fiscalDocuments.mockResolvedValue([]);
    mocks.refunds.mockResolvedValue([]);
    mocks.shipments.mockResolvedValue([]);
    mocks.admins.mockResolvedValue([
      { email: "first-admin@example.com" },
      { email: "second-admin@example.com" },
      { email: "older-super@example.com" },
    ]);
    mocks.setting.mockImplementation(({ where }: { where: { key: string } }) =>
      where.key === URGENT_ADMIN_ALERT_RECIPIENTS_SETTING_KEY
        ? Promise.resolve({
            value: ["first-admin@example.com", "second-admin@example.com"],
          })
        : Promise.resolve(null),
    );
    mocks.upsertSetting.mockResolvedValue({ key: URGENT_ADMIN_ALERT_SETTING_KEY });
    mocks.trackedDispatch.mockResolvedValue({
      ok: true,
      id: "message-id",
      provider: "none",
    });
  });

  it("sends each enabled SUPER admin an idempotent digest", async () => {
    mocks.backgroundJobs.mockResolvedValue([
      {
        id: "job-1",
        kind: "PAYMENT_REFUND",
        lastError: "Provider is unavailable",
        updatedAt: new Date("2026-08-10T10:00:00.000Z"),
      },
    ]);

    await expect(processUrgentAdminAlerts()).resolves.toEqual({
      scanned: 1,
      recipients: 2,
      sent: 2,
      failed: 0,
      skipped: 0,
    });
    expect(mocks.trackedDispatch).toHaveBeenCalledTimes(2);
    expect(mocks.trackedDispatch).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        kind: "urgent_admin_alert",
        to: "first-admin@example.com",
        subject: expect.stringContaining("[HITNO]"),
        idempotencyKey: expect.stringContaining("urgent-admin:"),
      }),
    );
    expect(mocks.trackedDispatch).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ to: "second-admin@example.com" }),
    );
    expect(mocks.upsertSetting).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: URGENT_ADMIN_ALERT_SETTING_KEY },
      }),
    );
  });

  it("records a clear state without sending mail when no failure is open", async () => {
    await expect(processUrgentAdminAlerts()).resolves.toEqual({
      scanned: 0,
      recipients: 2,
      sent: 0,
      failed: 0,
      skipped: 0,
    });
    expect(mocks.trackedDispatch).not.toHaveBeenCalled();
    expect(mocks.upsertSetting).toHaveBeenCalledWith({
      where: { key: URGENT_ADMIN_ALERT_SETTING_KEY },
      create: { key: URGENT_ADMIN_ALERT_SETTING_KEY, value: "clear" },
      update: { value: "clear" },
    });
  });
});
