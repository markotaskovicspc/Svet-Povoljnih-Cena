import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ claim: vi.fn(), queue: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { reclamation: { findUnique: mocks.claim } } }));
vi.mock("@/lib/viber/outbox", () => ({ queueNthMessage: mocks.queue }));
import { resolveReclamationChannel } from "@/lib/viber/reclamation-notifications";
import { __resetViberConfig } from "@/lib/viber/config";

const noEmail = { number: "RCL-7", status: "U_OBRADI", resolution: "POVRAT_NOVCA", customerEmail: null, customerPhone: null, order: { number: "SPC-1", shipPhone: "063 123 4567", guestEmail: null, user: null } };

function enabled() {
  vi.stubEnv("VIBER_PROVIDER", "nth"); vi.stubEnv("NTH_DELIVERY_MODE", "worker");
  vi.stubEnv("NTH_WORKER_TOKEN", "test-worker-token-with-at-least-32-characters");
  vi.stubEnv("VIBER_PRODUCTION_ACCEPTED", "true"); vi.stubEnv("VIBER_RECLAMATION_NOTIFICATIONS_ENABLED", "true");
  vi.stubEnv("NTH_RECLAMATION_RECEIPT_TEMPLATE_ID", "rcl-receipt"); vi.stubEnv("NTH_RECLAMATION_ACCEPTED_TEMPLATE_ID", "rcl-accepted");
  vi.stubEnv("NTH_RECLAMATION_STATUS_TEMPLATE_ID", "rcl-status");
  __resetViberConfig();
  mocks.claim.mockResolvedValue(noEmail);
  mocks.queue.mockResolvedValue({ ok: true });
}
afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks(); __resetViberConfig(); });

it("keeps the legacy e-mail flow while the switch is off", async () => {
  enabled(); vi.stubEnv("VIBER_RECLAMATION_NOTIFICATIONS_ENABLED", "false");
  expect(await resolveReclamationChannel({ kind: "RECEIPT", reclamationId: "r1" })).toEqual({ channel: "legacy" });
  expect(mocks.queue).not.toHaveBeenCalled();
});

it("never sends Viber to a buyer who has any e-mail", async () => {
  enabled();
  mocks.claim.mockResolvedValue({ ...noEmail, order: { ...noEmail.order, user: { email: "nalog@example.rs" } } });
  expect(await resolveReclamationChannel({ kind: "STATUS", reclamationId: "r1" })).toEqual({ channel: "email", to: "nalog@example.rs" });
  mocks.claim.mockResolvedValue({ ...noEmail, customerEmail: " kupac@example.rs " });
  expect(await resolveReclamationChannel({ kind: "RECEIPT", reclamationId: "r1" })).toEqual({ channel: "email", to: "kupac@example.rs" });
  expect(mocks.queue).not.toHaveBeenCalled();
});

it("queues transactional templates for buyers without e-mail", async () => {
  enabled();
  expect(await resolveReclamationChannel({ kind: "RECEIPT", reclamationId: "r1" })).toEqual({ channel: "queued" });
  expect(await resolveReclamationChannel({ kind: "ACCEPTED", reclamationId: "r1" })).toEqual({ channel: "queued" });
  expect(await resolveReclamationChannel({ kind: "STATUS", reclamationId: "r1", eventKey: "ev9" })).toEqual({ channel: "queued" });
  const calls = mocks.queue.mock.calls.map(c => c[0]);
  expect(calls[0]).toEqual({ to: "381631234567", text: "", kind: "transaction", requestId: "reclamation:r1:receipt", template: { id: "rcl-receipt", lang: "sr", parameters: { reclamation_number: "RCL-7", order_number: "SPC-1" } } });
  expect(calls[1]).toMatchObject({ requestId: "reclamation:r1:accepted:POVRAT_NOVCA", template: { parameters: { resolution: "povraćaj novca" } } });
  expect(calls[2]).toMatchObject({ requestId: "reclamation:r1:status:ev9", template: { parameters: { status: "u obradi" } } });
});

it("reports none when a buyer without e-mail cannot be reached on Viber", async () => {
  enabled();
  mocks.claim.mockResolvedValue({ ...noEmail, customerPhone: "123", order: { ...noEmail.order, shipPhone: "" } });
  expect(await resolveReclamationChannel({ kind: "RECEIPT", reclamationId: "r1" })).toEqual({ channel: "none" });
  enabled(); vi.stubEnv("NTH_RECLAMATION_STATUS_TEMPLATE_ID", "");
  expect(await resolveReclamationChannel({ kind: "STATUS", reclamationId: "r1" })).toEqual({ channel: "none" });
});
