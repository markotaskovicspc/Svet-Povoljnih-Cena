import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ findUnique: vi.fn(), dispatch: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { reclamation: { findUnique: mocks.findUnique } } }));
vi.mock("@/lib/email/tracking", () => ({ trackedDispatch: mocks.dispatch }));
vi.mock("@/lib/email/config", () => ({ getEmailConfig: () => ({ baseUrl: "https://www.svetpovoljnihcena.rs", reclamationsInbox: "reklamacije@svetpovoljnihcena.rs" }) }));
import { sendReclamationNotification } from "@/lib/email/reclamation-notification";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.findUnique.mockResolvedValue({ id: "case-1", number: "R-1", order: { number: "SPC-1" }, sku: "110054", quantity: 1, customerFirst: "Test", customerLast: "Kupac", customerEmail: null, customerPhone: "0601234567", type: "REKLAMACIJA", request: "POVRACAJ_NOVCA", description: "<script>problem</script>", photos: [{ id: "photo-1" }] });
  mocks.dispatch.mockResolvedValue({ ok: true });
});
it("notifies the reclamation inbox without a customer email and links to the exact case", async () => {
  await sendReclamationNotification("case-1");
  expect(mocks.dispatch).toHaveBeenCalledWith(expect.objectContaining({ to: "reklamacije@svetpovoljnihcena.rs", idempotencyKey: "reclamation-notification:case-1", text: expect.stringContaining("Email: nije naveden") }));
  const mail = mocks.dispatch.mock.calls[0][0];
  expect(mail.html).toContain("/admin/erp/reklamacije-dnevnik/case-1");
  expect(mail.html).toContain("&lt;script&gt;");
  expect(mail.html).not.toContain("<script>");
});
it("propagates failed delivery so the background queue can retry", async () => {
  mocks.dispatch.mockResolvedValue({ ok: false, error: "provider unavailable" });
  expect(await sendReclamationNotification("case-1")).toEqual({ ok: false, error: "provider unavailable" });
});
