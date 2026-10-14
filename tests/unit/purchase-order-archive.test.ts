import { beforeEach, expect, it, vi } from "vitest";

const updateMany = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db", () => ({ db: { purchaseOrder: { updateMany } } }));
import { setPurchaseOrdersArchived } from "@/lib/admin/purchase-order-archive.server";

beforeEach(() => {
  vi.clearAllMocks();
  updateMany.mockResolvedValue({ count: 2 });
});

it("archives selected documents without changing their status or stock", async () => {
  expect(await setPurchaseOrdersArchived(["one", "two", "one"], true)).toBe(2);
  expect(updateMany).toHaveBeenCalledWith({
    where: { id: { in: ["one", "two"] }, archivedAt: null },
    data: { archivedAt: expect.any(Date) },
  });
});

it("restores only archived documents and preserves the original status", async () => {
  await setPurchaseOrdersArchived(["one"], false);
  expect(updateMany).toHaveBeenCalledWith({
    where: { id: { in: ["one"] }, archivedAt: { not: null } },
    data: { archivedAt: null },
  });
});

it("rejects an empty selection", async () => {
  await expect(setPurchaseOrdersArchived([], true)).rejects.toThrow("Izaberite");
  expect(updateMany).not.toHaveBeenCalled();
});
