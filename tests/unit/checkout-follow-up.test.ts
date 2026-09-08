import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ order: vi.fn(), enqueue: vi.fn(), process: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { order: { findUniqueOrThrow: mocks.order } } }));
vi.mock("@/lib/background-jobs", () => ({ enqueueBackgroundJob: mocks.enqueue, processBackgroundJob: mocks.process }));
import { prepareCheckoutFollowUp } from "@/lib/checkout/follow-up";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.order.mockResolvedValue({
    number: "SPC-TEST", paymentMethod: "POUZECE_GOTOVINA", shippingMethod: "KURIR",
    supplierFulfillments: [{ id: "supplier1" }],
    items: [{ qty: 1, productId: "p1", product: { supplier: null } }],
  });
  mocks.enqueue.mockImplementation(async ({ idempotencyKey }) => ({ id: idempotencyKey }));
  mocks.process.mockResolvedValue({ claimed: true, ok: true });
});

it("persists all independent jobs before invoking any provider and runs buyer despite broken supplier PDF", async () => {
  mocks.process.mockImplementation(async (id: string) => {
    expect(mocks.enqueue).toHaveBeenCalledTimes(4);
    if (id.startsWith("supplier-order:")) throw new Error("Broken PDF");
    return { claimed: true, ok: true };
  });
  await expect(prepareCheckoutFollowUp("o1", "access-token-1234567890")).resolves.toBeUndefined();
  expect(mocks.process).toHaveBeenCalledWith("buyer-receipt:o1");
  expect(mocks.process).toHaveBeenCalledWith("supplier-shipping-documents:supplier1:checkout");
});

it("propagates partial queue failure so the durable parent retries with identical keys", async () => {
  mocks.enqueue.mockRejectedValueOnce(new Error("Database unavailable"));
  await expect(prepareCheckoutFollowUp("o1", "access-token-1234567890")).rejects.toThrow("Database unavailable");
  expect(mocks.process).not.toHaveBeenCalled();
  await prepareCheckoutFollowUp("o1", "access-token-1234567890");
  expect(mocks.enqueue.mock.calls[0][0].idempotencyKey).toBe(mocks.enqueue.mock.calls[1][0].idempotencyKey);
});

it("preserves prepaid shipping-document timing: checkout does not queue courier work before payment", async () => {
  mocks.order.mockResolvedValue({
    number: "SPC-TEST", paymentMethod: "IPS", shippingMethod: "KURIR",
    supplierFulfillments: [{ id: "supplier1" }], items: [],
  });
  await prepareCheckoutFollowUp("o1", "access-token-1234567890");
  expect(mocks.enqueue.mock.calls.map(([args]) => args.kind)).toEqual(["BUYER_RECEIPT", "SUPPLIER_ORDER_EMAIL"]);
});
