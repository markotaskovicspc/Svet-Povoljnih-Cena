import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), admin: vi.fn() }));
vi.mock("@/lib/auth/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/db", () => ({ db: { adminUser: { findUnique: mocks.admin } } }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(url); } }));

import { getCurrentAdmin, requireAdmin } from "@/lib/auth/session";
import { requireAdminAction } from "@/lib/admin/guard";

beforeEach(() => {
  mocks.auth.mockResolvedValue({ user: { id: "admin-1", userType: "admin", role: "SUPER" } });
  mocks.admin.mockResolvedValue({ id: "admin-1", email: "admin@example.test", firstName: "Admin", lastName: "Test", role: "OPS", enabled: true });
});

describe("shared authoritative admin read", () => {
  it.each([null, { enabled: false }])("rejects missing/disabled database accounts", async (record) => {
    mocks.admin.mockResolvedValue(record);
    expect(await getCurrentAdmin()).toBeNull();
    await expect(requireAdmin()).rejects.toThrow("/admin/prijava");
    await expect(requireAdminAction()).rejects.toThrow("/admin/prijava");
  });

  it.each([null, { user: { userType: "customer" } }, { user: { userType: "admin", invalidated: true } }])("rejects non-admin/invalidated sessions without a database lookup", async (session) => {
    mocks.auth.mockResolvedValue(session);
    expect(await getCurrentAdmin()).toBeNull();
    expect(mocks.admin).not.toHaveBeenCalled();
  });

  it("uses the database role rather than stale SUPER claims", async () => {
    expect(await requireAdminAction(["OPS"])).toMatchObject({ role: "OPS", name: "Admin Test" });
    await expect(requireAdminAction(["CONTENT"])).rejects.toThrow("/admin?forbidden=1");
    await expect(requireAdmin(["CONTENT"])).rejects.toThrow("/admin?forbidden=1");
  });

  it("does not persist authorization in a module/global cache", async () => {
    expect(await getCurrentAdmin()).not.toBeNull();
    mocks.admin.mockResolvedValue({ enabled: false });
    expect(await getCurrentAdmin()).toBeNull();
  });
});
