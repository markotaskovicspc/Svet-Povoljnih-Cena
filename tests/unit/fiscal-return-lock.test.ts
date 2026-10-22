import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ query: vi.fn(), release: vi.fn(), connect: vi.fn(), pool: vi.fn() }));
vi.mock("@/lib/db", () => ({ createDatabasePool: m.pool }));
import { withOrderReturnLock } from "@/lib/fiscal/return-lock";
beforeEach(() => {
  vi.clearAllMocks();
  m.pool.mockReturnValue({ connect: m.connect });
  m.connect.mockResolvedValue({ query: m.query, release: m.release });
  m.query.mockResolvedValue({ rows: [{ locked: true }] });
});
it("holds a separate connection while ordinary database work completes", async () => {
  const work = vi.fn(async () => "done");
  await expect(withOrderReturnLock("order", work)).resolves.toBe("done");
  expect(m.pool).toHaveBeenCalledWith(1);
  expect(m.query).toHaveBeenCalledWith("SELECT pg_try_advisory_xact_lock(hashtext($1)) AS locked", ["order-return:order"]);
  expect(m.query).toHaveBeenLastCalledWith("COMMIT");
  expect(m.release).toHaveBeenCalledWith(false);
});
it("does not dispatch work when a competing process holds the lock", async () => {
  m.query.mockResolvedValue({ rows: [{ locked: false }] });
  const work = vi.fn();
  await expect(withOrderReturnLock("order", work)).rejects.toThrow("već obrađuje");
  expect(work).not.toHaveBeenCalled();
  expect(m.query).toHaveBeenLastCalledWith("ROLLBACK");
});
it("destroys a connection whose rollback failed", async () => {
  m.query.mockImplementation(async (sql: string) => {
    if (sql === "ROLLBACK") throw new Error("lost session");
    return { rows: [{ locked: true }] };
  });
  await expect(withOrderReturnLock("order", async () => { throw new Error("provider uncertain"); })).rejects.toThrow("provider uncertain");
  expect(m.release).toHaveBeenCalledWith(true);
});
