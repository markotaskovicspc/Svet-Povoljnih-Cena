import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), findUnique: vi.fn(), redirect: vi.fn() }));
vi.mock("@/lib/auth/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/db", () => ({ db: { adminUser: { findUnique: mocks.findUnique } } }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
import { getCurrentAdmin } from "@/lib/auth/session";
import { canAccessAdminModule } from "@/lib/admin/access-policy";

describe("admin access is loaded from the database, not the login token", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { id: "staff", role: "SUPER", userType: "admin" } });
  });
  it("revokes a module for an already signed-in user on the next request", async () => {
    const record = { id: "staff", email: "qa@example.invalid", role: "CUSTOM", enabled: true,
      accessPolicy: { version: 1, modules: ["/admin/viber", "/admin/newsletter"] } };
    mocks.findUnique.mockResolvedValueOnce(record).mockResolvedValueOnce({ ...record, accessPolicy: { version: 1, modules: ["/admin/newsletter"] } });
    const before = await getCurrentAdmin();
    expect(before?.role).toBe("CUSTOM");
    expect(canAccessAdminModule(before, "/admin/viber")).toBe(true);
    const after = await getCurrentAdmin();
    expect(canAccessAdminModule(after, "/admin/viber")).toBe(false);
    expect(mocks.findUnique).toHaveBeenCalledTimes(2);
    expect(mocks.findUnique.mock.calls[0][0].select.accessPolicy).toBe(true);
  });
  it("rejects a disabled or deleted account even while its token remains valid", async () => {
    mocks.findUnique.mockResolvedValueOnce({ id: "staff", role: "CUSTOM", enabled: false }).mockResolvedValueOnce(null);
    expect(await getCurrentAdmin()).toBeNull();
    expect(await getCurrentAdmin()).toBeNull();
  });
});
