import { expect, it, vi } from "vitest";

const { create } = vi.hoisted(() => ({ create: vi.fn().mockResolvedValue({ id: "job", status: "PENDING" }) }));
vi.mock("@/lib/db", () => ({ db: { backgroundJob: { create } } }));
vi.mock("@/lib/channel-availability.server", () => ({}));
import { enqueueBackgroundJob } from "@/lib/background-jobs";

it("queues the buyer notification when a new item starts at zero", async () => {
  await expect(enqueueBackgroundJob({
    kind: "ORDER_ITEMS_CHANGED_EMAIL", idempotencyKey: "new-item",
    payload: { orderId: "order", itemName: "Artikal", sku: "SKU", previousQty: 0, newQty: 1, operationKey: "add" },
  })).resolves.toMatchObject({ id: "job" });
  expect(create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ payload: expect.objectContaining({ previousQty: 0, newQty: 1 }) }) }));
});

it("still rejects negative previous quantities before writing a job", async () => {
  await expect(enqueueBackgroundJob({
    kind: "ORDER_ITEMS_CHANGED_EMAIL", idempotencyKey: "invalid-item",
    payload: { orderId: "order", itemName: "Artikal", sku: "SKU", previousQty: -1, newQty: 1, operationKey: "add" },
  })).rejects.toThrow();
  expect(create).not.toHaveBeenCalled();
});
