import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn(), meta: vi.fn(), hash: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { adminUser: { create: mock.create, updateMany: mock.update } } }));
vi.mock("bcryptjs", () => ({ default: { hash: mock.hash } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/admin", () => ({ withAdminState: (meta: unknown, handler: () => unknown) => { mock.meta(meta); return handler; } }));
import { createOperator, setOperatorEnabled } from "@/app/admin/erp/operativci/actions";
const state = { ok: false, message: "" };
beforeEach(() => { vi.clearAllMocks(); mock.create.mockResolvedValue({ id: "operator" }); mock.update.mockResolvedValue({ count: 1 }); mock.hash.mockResolvedValue("HASH"); });
describe("warehouse accounts", () => {
  it("always creates a warehouse account and keeps passwords out of audit results", async () => {
    const form = new FormData();
    for (const [key, value] of Object.entries({ firstName: "Milan", lastName: "", email: "Milan@example.invalid", password: "Secret!234", role: "SUPER" })) form.set(key, value);
    const result = await createOperator(state, form);
    expect(mock.meta).toHaveBeenCalledWith(expect.objectContaining({ allowed: ["OPS"] }));
    expect(mock.hash).toHaveBeenCalledWith("Secret!234", 12);
    expect(mock.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ email: "milan@example.invalid", passwordHash: "HASH", role: "WAREHOUSE" }) }));
    expect(JSON.stringify(result)).not.toContain("Secret!234");
    expect(JSON.stringify(result)).not.toContain("HASH");
  });
  it("cannot disable or modify an administrator through an operator form", async () => {
    const form = new FormData(); form.set("id", "admin"); form.set("enabled", "false");
    mock.update.mockResolvedValue({ count: 0 });
    const result = await setOperatorEnabled(state, form);
    expect(mock.update).toHaveBeenCalledWith({ where: { id: "admin", role: "WAREHOUSE" }, data: { enabled: false } });
    expect(result.ok).toBe(false);
  });
  it("rejects incomplete account data before writing", async () => {
    const result = await createOperator(state, new FormData());
    expect(result.ok).toBe(false); expect(mock.create).not.toHaveBeenCalled();
  });
});
