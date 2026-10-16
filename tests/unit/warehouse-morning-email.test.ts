import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ send: vi.fn(), session: vi.fn() }));
vi.mock("@/lib/email/tracking", () => ({ trackedDispatch: mocks.send }));
vi.mock("@/lib/email/config", () => ({ getEmailConfig: () => ({ baseUrl: "https://shop.example/" }) }));
vi.mock("@/lib/admin/picking.server", () => ({ getPickingSession: mocks.session }));
import { sendWarehouseMorningEmail } from "@/lib/admin/warehouse-morning-email.server";
const payload = { batchId: "batch", provider: "MYGLS" as const, date: "2026-10-17" };
beforeEach(() => {
  vi.clearAllMocks(); mocks.send.mockResolvedValue({ ok: true });
  mocks.session.mockResolvedValue({ id: "batch", number: "PRE-0082", rows: [{ sku: "001", name: "A < B", quantity: 3, warehouseName: "DC", positions: [2, 4] }] });
});
it("sends the morning work summary to the warehouse with authenticated workflow links", async () => {
  await sendWarehouseMorningEmail(payload);
  const message = mocks.send.mock.calls[0][0];
  expect(message).toMatchObject({ to: "magacin@svetpovoljnihcena.rs", kind: "WAREHOUSE_MORNING", idempotencyKey: "warehouse-morning:2026-10-17:MYGLS" });
  expect(message.text).toContain("3 kom.");
  expect(message.text).toContain("Pozicije: 2, 4");
  expect(message.html).toContain("A &lt; B");
  expect(message.html).toContain('href="https://shop.example/admin/magacin/picking/batch"');
  expect(message.html).toContain('href="https://shop.example/admin/magacin/povrat"');
  expect(message.attachments).toBeUndefined();
});
it("retains the same delivery key when retried", async () => {
  await sendWarehouseMorningEmail(payload); await sendWarehouseMorningEmail(payload);
  expect(mocks.send.mock.calls[0][0].idempotencyKey).toBe(mocks.send.mock.calls[1][0].idempotencyKey);
});
it("reports empty work explicitly and propagates transport failure for retry", async () => {
  mocks.session.mockResolvedValue({ id: "batch", number: "PRE-0082", rows: [] });
  mocks.send.mockResolvedValue({ ok: false, error: "temporary" });
  await expect(sendWarehouseMorningEmail(payload)).rejects.toThrow("temporary");
  expect(mocks.send.mock.calls[0][0].text).toContain("Nema artikala za odvajanje");
});
