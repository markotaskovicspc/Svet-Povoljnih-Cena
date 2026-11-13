import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ claim: vi.fn(), order: vi.fn(), queue: vi.fn(), enqueue: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { reclamation: { findUnique: mocks.claim }, order: { findUnique: mocks.order } } }));
vi.mock("@/lib/viber/outbox", () => ({ queueNthMessage: mocks.queue }));
vi.mock("@/lib/background-jobs", () => ({ enqueueBackgroundJob: mocks.enqueue }));
import { queueReclamationEmailFallback, queueReclamationViber } from "@/lib/viber/reclamation-notifications";
import { __resetViberConfig } from "@/lib/viber/config";

function enabled() {
  vi.stubEnv("VIBER_PROVIDER", "nth"); vi.stubEnv("NTH_DELIVERY_MODE", "worker");
  vi.stubEnv("NTH_WORKER_TOKEN", "test-worker-token-with-at-least-32-characters");
  vi.stubEnv("VIBER_PRODUCTION_ACCEPTED", "true"); vi.stubEnv("VIBER_RECLAMATION_NOTIFICATIONS_ENABLED", "true");
  vi.stubEnv("NTH_RECLAMATION_RECEIPT_TEMPLATE_ID", "rcl-receipt"); vi.stubEnv("NTH_RECLAMATION_ACCEPTED_TEMPLATE_ID", "rcl-accepted");
  vi.stubEnv("NTH_RECLAMATION_STATUS_TEMPLATE_ID", "rcl-status"); vi.stubEnv("NTH_RECLAMATION_LINK_TEMPLATE_ID", "rcl-link");
  vi.stubEnv("NEXT_PUBLIC_BASE_URL", "https://shop.test");
  __resetViberConfig();
  mocks.claim.mockResolvedValue({ number: "RCL-7", status: "U_OBRADI", resolution: "POVRAT_NOVCA", customerPhone: null, order: { number: "SPC-1", shipPhone: "063 123 4567" } });
  mocks.order.mockResolvedValue({ number: "SPC-1", shipPhone: "0631234567" });
  mocks.queue.mockResolvedValue({ ok: true });
}
afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks(); __resetViberConfig(); });

it("keeps the legacy e-mail flow while the switch is off", async () => {
  enabled(); vi.stubEnv("VIBER_RECLAMATION_NOTIFICATIONS_ENABLED", "false");
  expect(await queueReclamationViber({ kind: "RECEIPT", reclamationId: "r1" })).toBe("disabled");
  expect(mocks.queue).not.toHaveBeenCalled();
});

it("queues transactional templates with the order phone and stable request ids", async () => {
  enabled();
  expect(await queueReclamationViber({ kind: "RECEIPT", reclamationId: "r1" })).toBe("queued");
  expect(await queueReclamationViber({ kind: "ACCEPTED", reclamationId: "r1" })).toBe("queued");
  expect(await queueReclamationViber({ kind: "STATUS", reclamationId: "r1" })).toBe("queued");
  expect(await queueReclamationViber({ kind: "LINK", orderId: "o1", accessToken: "tok_abcdefghijklmnopqrst" })).toBe("queued");
  const calls = mocks.queue.mock.calls.map(c => c[0]);
  expect(calls[0]).toEqual({ to: "381631234567", text: "", kind: "transaction", requestId: "rclfb:RECEIPT:r1", template: { id: "rcl-receipt", lang: "sr", parameters: { reclamation_number: "RCL-7", order_number: "SPC-1" } } });
  expect(calls[1]).toMatchObject({ requestId: "rclfb:ACCEPTED:r1:POVRAT_NOVCA", template: { parameters: { resolution: "povraćaj novca" } } });
  expect(calls[2]).toMatchObject({ requestId: "rclfb:STATUS:r1:U_OBRADI", template: { parameters: { status: "u obradi" } } });
  expect(calls[3]).toMatchObject({ requestId: "rclfb:LINK:o1:tok_abcdefghijklmnopqrst", template: { parameters: { order_number: "SPC-1", link: "https://shop.test/reklamacije/prijava?order=SPC-1&token=tok_abcdefghijklmnopqrst" } } });
});

it("falls back to e-mail when the buyer cannot be reached on Viber", async () => {
  enabled();
  mocks.claim.mockResolvedValue({ number: "RCL-7", status: "PRIMLJENO", resolution: null, customerPhone: "123", order: { number: "SPC-1", shipPhone: "" } });
  expect(await queueReclamationViber({ kind: "RECEIPT", reclamationId: "r1" })).toBe("unavailable");
  enabled(); vi.stubEnv("NTH_RECLAMATION_STATUS_TEMPLATE_ID", "");
  expect(await queueReclamationViber({ kind: "STATUS", reclamationId: "r1" })).toBe("unavailable");
  enabled(); mocks.queue.mockResolvedValue({ ok: false, error: "nth:previous_send_requires_review" });
  expect(await queueReclamationViber({ kind: "RECEIPT", reclamationId: "r1" })).toBe("unavailable");
});

it("re-queues the matching e-mail job when Viber fails", async () => {
  mocks.enqueue.mockResolvedValue({ id: "j" });
  expect(await queueReclamationEmailFallback("order:o1:confirmation:received")).toBe(false);
  expect(await queueReclamationEmailFallback("rclfb:STATUS:r1:ev9")).toBe(true);
  expect(await queueReclamationEmailFallback("rclfb:LINK:o1:tok_abcdefghijklmnopqrst")).toBe(true);
  expect(mocks.enqueue.mock.calls[0][0]).toEqual({ kind: "RECLAMATION_STATUS_EMAIL", payload: { reclamationId: "r1", eventId: "ev9", viaEmail: true }, idempotencyKey: "rclfb:STATUS:r1:ev9:email" });
  expect(mocks.enqueue.mock.calls[1][0]).toMatchObject({ kind: "GUEST_RECLAMATION_LINK_EMAIL", payload: { orderId: "o1", accessToken: "tok_abcdefghijklmnopqrst", viaEmail: true } });
});
