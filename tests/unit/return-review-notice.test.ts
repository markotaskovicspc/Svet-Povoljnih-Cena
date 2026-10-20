import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ shipment: vi.fn(), send: vi.fn(), cfg: { provider: "ses", baseUrl: "https://www.svetpovoljnihcena.rs" } }));
vi.mock("@/lib/db", () => ({ db: { shipment: { findUnique: m.shipment } } }));
vi.mock("@/lib/email/config", () => ({ getEmailConfig: () => m.cfg }));
vi.mock("@/lib/email/tracking", () => ({ trackedDispatch: m.send }));
import { sendReturnReviewOfficeNotice } from "@/lib/email/return-review-notice";
beforeEach(() => {
  vi.clearAllMocks();
  m.cfg.provider = "ses";
  m.shipment.mockResolvedValue({ id: "s1", orderId: "o1", order: { number: "SPC-1" }, reclamation: { id: "r1", number: "R-1 <test>" }, provider: "X_EXPRESS", providerParcelNumbers: ["AAA0850302567"] });
  m.send.mockResolvedValue({ ok: true });
});
describe("unlinked return office notice", () => {
  it("sends only the resolved parcel identity and review link using a stable deduplication key", async () => {
    await sendReturnReviewOfficeNotice({ shipmentId: "s1", parcelNumber: "AAA0850302567" });
    expect(m.send).toHaveBeenCalledWith(expect.objectContaining({
      to: "office@svetpovoljnihcena.rs", idempotencyKey: "return-review:s1:AAA0850302567",
      text: expect.stringContaining("/admin/erp/reklamacije-dnevnik/r1"),
      html: expect.stringContaining("R-1 &lt;test&gt;"),
    }));
    expect(m.send.mock.calls[0][0].text).toContain("ne povećava lager");
  });
  it("refuses a code that does not belong to the resolved shipment", async () => {
    await expect(sendReturnReviewOfficeNotice({ shipmentId: "s1", parcelNumber: "UNKNOWN" })).rejects.toThrow("nije povezan");
    expect(m.send).not.toHaveBeenCalled();
  });
  it("propagates delivery failures to the durable worker for retry", async () => {
    m.send.mockResolvedValue({ ok: false, error: "temporarily unavailable" });
    await expect(sendReturnReviewOfficeNotice({ shipmentId: "s1", parcelNumber: "AAA0850302567" })).rejects.toThrow("temporarily unavailable");
    m.cfg.provider = "none";
    await expect(sendReturnReviewOfficeNotice({ shipmentId: "s1", parcelNumber: "AAA0850302567" })).rejects.toThrow("nije podešen");
  });
});
