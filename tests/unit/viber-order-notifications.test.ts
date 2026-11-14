import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ order: vi.fn(), queue: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { order: { findUnique: mocks.order } } }));
vi.mock("@/lib/viber/outbox", () => ({ queueNthMessage: mocks.queue }));
vi.mock("@/lib/orders/customer-documents", () => ({ orderDocumentsShortLink: (n: string) => `shop.test/d/${n}/sig` }));
import { queueFiscalReceiptViber, queueOrderViberNotification } from "@/lib/viber/order-notifications";
import { __resetViberConfig } from "@/lib/viber/config";

function enabled() {
  vi.stubEnv("VIBER_PROVIDER", "nth"); vi.stubEnv("NTH_DELIVERY_MODE", "worker");
  vi.stubEnv("NTH_WORKER_TOKEN", "test-worker-token-with-at-least-32-characters");
  vi.stubEnv("VIBER_PRODUCTION_ACCEPTED", "true"); vi.stubEnv("VIBER_ORDER_NOTIFICATIONS_ENABLED", "true");
  vi.stubEnv("NTH_ORDER_CONFIRMATION_TEMPLATE_ID", "approved-confirmation"); vi.stubEnv("NTH_ORDER_STATUS_TEMPLATE_ID", "approved-status");
  __resetViberConfig();
  mocks.order.mockResolvedValue({ number: "SPC-12345", shipPhone: "0631234567", status: "U_ISPORUCI", guestEmail: null, user: null });
  mocks.queue.mockResolvedValue({ ok: true });
}
afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks(); __resetViberConfig(); });

it("does not queue any order before provider acceptance and template approval", async () => {
  enabled(); vi.stubEnv("VIBER_ORDER_NOTIFICATIONS_ENABLED", "false");
  await queueOrderViberNotification("o1", "confirmation");
  expect(mocks.queue).not.toHaveBeenCalled();
  vi.stubEnv("VIBER_ORDER_NOTIFICATIONS_ENABLED", "true"); vi.stubEnv("NTH_ORDER_CONFIRMATION_TEMPLATE_ID", "");
  await queueOrderViberNotification("o1", "confirmation");
  expect(mocks.queue).not.toHaveBeenCalled();
});
it("uses stable per-order keys and transactional parameters, without promotional media", async () => {
  enabled();
  await queueOrderViberNotification("o1", "confirmation");
  await queueOrderViberNotification("o1", "status");
  expect(mocks.queue.mock.calls[0][0]).toEqual({ to: "0631234567", text: "", kind: "transaction", requestId: "order:o1:confirmation:received", template: { id: "approved-confirmation", lang: "sr", parameters: { order_number: "SPC-12345" } } });
  expect(mocks.queue.mock.calls[1][0]).toMatchObject({ requestId: "order:o1:status:U_ISPORUCI", template: { parameters: { status: "u isporuci" } } });
});
it("sends only to orders without any email unless the scope is widened", async () => {
  enabled();
  mocks.order.mockResolvedValue({ number: "SPC-1", shipPhone: "0631234567", status: "KREIRANO", guestEmail: "kupac@example.rs", user: null });
  await queueOrderViberNotification("o1", "confirmation");
  mocks.order.mockResolvedValue({ number: "SPC-2", shipPhone: "0631234567", status: "KREIRANO", guestEmail: null, user: { email: "nalog@example.rs" } });
  await queueOrderViberNotification("o2", "status");
  expect(mocks.queue).not.toHaveBeenCalled();
  mocks.order.mockResolvedValue({ number: "SPC-3", shipPhone: "0631234567", status: "KREIRANO", guestEmail: "  ", user: { email: null } });
  await queueOrderViberNotification("o3", "confirmation");
  expect(mocks.queue).toHaveBeenCalledTimes(1);
  vi.stubEnv("VIBER_ORDER_NOTIFICATIONS_SCOPE", "all");
  mocks.order.mockResolvedValue({ number: "SPC-4", shipPhone: "0631234567", status: "KREIRANO", guestEmail: "kupac@example.rs", user: null });
  await queueOrderViberNotification("o4", "confirmation");
  expect(mocks.queue).toHaveBeenCalledTimes(2);
});
it("links the documents page from the confirmation and the fiscal receipt notice", async () => {
  enabled();
  vi.stubEnv("NTH_ORDER_CONFIRMATION_DOCS_TEMPLATE_ID", "approved-docs"); vi.stubEnv("NTH_FISCAL_RECEIPT_TEMPLATE_ID", "approved-fiscal");
  await queueOrderViberNotification("o1", "confirmation");
  expect(await queueFiscalReceiptViber("o1")).toBe(true);
  expect(mocks.queue.mock.calls[0][0]).toMatchObject({ requestId: "order:o1:confirmation:received", template: { id: "approved-docs", parameters: { order_number: "SPC-12345", link: "shop.test/d/SPC-12345/sig" } } });
  expect(mocks.queue.mock.calls[1][0]).toMatchObject({ requestId: "order:o1:fiscal-receipt", template: { id: "approved-fiscal", parameters: { order_number: "SPC-12345" } } });
  mocks.order.mockResolvedValue({ number: "SPC-9", shipPhone: "0631234567", status: "ISPORUCENO", guestEmail: "kupac@example.rs", user: null });
  expect(await queueFiscalReceiptViber("o2")).toBe(false);
  expect(mocks.queue).toHaveBeenCalledTimes(2);
});
