import { afterEach, expect, it, vi } from "vitest";
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/email", () => ({ loadOrderForEmail: vi.fn() }));
vi.mock("@/lib/email/config", () => ({ getEmailConfig: () => ({ baseUrl: "https://shop.test/" }) }));
vi.mock("@/lib/email/pdf", () => ({ buildWithdrawalFormPdf: vi.fn() }));
vi.mock("@/lib/email/guarantee-pdf", () => ({ buildGuaranteePdf: vi.fn(), guaranteeItemsForOrder: () => [] }));
import { orderDocumentsShortLink, orderDocumentsUrl, signOrderDocumentsToken, verifyOrderDocumentsToken } from "@/lib/orders/customer-documents";

afterEach(() => vi.unstubAllEnvs());

it("signs per order and rejects tokens for other orders", () => {
  vi.stubEnv("ORDER_ACCESS_TOKEN_SECRET", "test-secret");
  const token = signOrderDocumentsToken("SPC-2026-000001");
  expect(verifyOrderDocumentsToken("SPC-2026-000001", token)).toBe(true);
  expect(verifyOrderDocumentsToken("SPC-2026-000002", token)).toBe(false);
  expect(verifyOrderDocumentsToken("SPC-2026-000001", "")).toBe(false);
  expect(orderDocumentsShortLink("SPC-2026-000001")).toBe(`shop.test/d/SPC-2026-000001/${token}`);
  expect(orderDocumentsUrl("SPC-2026-000001")).toBe(`https://shop.test/porudzbina/dokumenti?order=SPC-2026-000001&t=${token}`);
});
