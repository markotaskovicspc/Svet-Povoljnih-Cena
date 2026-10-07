import { beforeEach, expect, it, vi } from "vitest";
const { tx, lock } = vi.hoisted(() => ({
  lock: vi.fn(),
  tx: {
    returnResolution: { findUnique: vi.fn(), create: vi.fn() },
    orderReshipment: { findUnique: vi.fn() },
    reclamation: { findUnique: vi.fn() },
    orderReshipmentItem: { findMany: vi.fn() },
    order: { findUniqueOrThrow: vi.fn() },
    stockMovement: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn() },
    orderStatusEvent: { create: vi.fn() },
  },
}));
vi.mock("@/lib/db", () => ({
  db: { $transaction: (fn: (client: typeof tx) => unknown) => fn(tx) },
}));
vi.mock("@/lib/fiscal/return-lock", () => ({ lockOrderReturn: lock }));
import { markReturnLost } from "@/lib/admin/return-resolution.server";
const input = {
  kind: "reshipment",
  id: "r",
  actorId: "admin",
  reason: "Kurir potvrdio gubitak",
};
beforeEach(() => {
  vi.resetAllMocks();
  tx.orderReshipment.findUnique.mockResolvedValue({ orderId: "o" });
  tx.orderReshipmentItem.findMany.mockResolvedValue([
    { quantity: 2, receivedQty: 1 },
  ]);
  tx.order.findUniqueOrThrow.mockResolvedValue({
    id: "o",
    number: "SPC-1",
    status: "VRACENO",
    items: [{ id: "i", qty: 2 }],
    shipments: [],
  });
  tx.stockMovement.findMany.mockResolvedValue([]);
  tx.returnResolution.create.mockImplementation(({ data }) => data);
});
it("closes only the remaining goods and records actor/reason without stock or order-status changes", async () => {
  expect(await markReturnLost(input)).toMatchObject({
    key: "reshipment:r",
    orderId: "o",
    actorId: "admin",
    reason: input.reason,
  });
  expect(lock).toHaveBeenCalledWith(tx, "o");
  expect(tx.stockMovement.create).not.toHaveBeenCalled();
  expect(tx.orderStatusEvent.create).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({ status: "VRACENO" }),
    }),
  );
});
it("is idempotent on repeat submissions", async () => {
  tx.returnResolution.findUnique.mockResolvedValue({ key: "reshipment:r" });
  await markReturnLost(input);
  expect(tx.returnResolution.create).not.toHaveBeenCalled();
  expect(tx.orderStatusEvent.create).not.toHaveBeenCalled();
});
it("does not close received reshipment goods as lost", async () => {
  tx.orderReshipmentItem.findMany.mockResolvedValue([
    { quantity: 2, receivedQty: 2 },
  ]);
  await expect(markReturnLost(input)).rejects.toThrow("u celosti primljen");
  expect(tx.returnResolution.create).not.toHaveBeenCalled();
});
it("requires a reason and a recognized return type", async () => {
  await expect(markReturnLost({ ...input, reason: "" })).rejects.toThrow(
    "razlog",
  );
  await expect(markReturnLost({ ...input, kind: "unknown" })).rejects.toThrow(
    "povrat",
  );
  expect(tx.returnResolution.create).not.toHaveBeenCalled();
});
it("rejects ordinary orders that are not returned", async () => {
  tx.order.findUniqueOrThrow.mockResolvedValue({
    status: "KREIRANO",
    shipments: [],
  });
  await expect(
    markReturnLost({ ...input, kind: "order", id: "o" }),
  ).rejects.toThrow("nije u povratu");
});
it("rejects fully received ordinary returns", async () => {
  tx.stockMovement.findMany.mockResolvedValue(
    [1, 2].map((n) => ({ idempotencyKey: `order-return:SPC-1:i:${n}` })),
  );
  await expect(
    markReturnLost({ ...input, kind: "order", id: "o" }),
  ).rejects.toThrow("u celosti primljen");
});
it("keeps a reshipment source out of the ordinary refund return flow", async () => {
  tx.order.findUniqueOrThrow.mockResolvedValue({
    status: "VRACENO",
    shipments: [
      {
        purpose: "ORDER_DELIVERY",
        status: "RETURNED",
        reshipment: { id: "r" },
      },
    ],
  });
  await expect(
    markReturnLost({ ...input, kind: "order", id: "o" }),
  ).rejects.toThrow("stare pošiljke");
});
it("rejects a received reclamation return", async () => {
  tx.reclamation.findUnique.mockResolvedValue({ orderId: "o" });
  tx.order.findUniqueOrThrow.mockResolvedValue({
    status: "VRACENO",
    shipments: [{ purpose: "RECLAMATION_RETURN", reclamationId: "r" }],
  });
  tx.stockMovement.findUnique.mockResolvedValue({ id: "receipt" });
  await expect(
    markReturnLost({ ...input, kind: "reclamation" }),
  ).rejects.toThrow("već primljen");
});
it("does not close a return while a receipt/refund has the lock", async () => {
  lock.mockRejectedValue(new Error("Povrat se već obrađuje"));
  await expect(markReturnLost(input)).rejects.toThrow("već obrađuje");
  expect(tx.returnResolution.create).not.toHaveBeenCalled();
});
