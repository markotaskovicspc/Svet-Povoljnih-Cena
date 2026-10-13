import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ admin: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getCurrentAdmin: mock.admin }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`redirect:${url}`); } }));
import { requireAdminAction } from "@/lib/admin/guard";
beforeEach(() => { mock.admin.mockResolvedValue({ id: "operator", role: "WAREHOUSE" }); });
describe("warehouse server authorization", () => {
  it("blocks generic admin guards and other ERP permissions", async () => {
    await expect(requireAdminAction()).rejects.toThrow("redirect:/admin/magacin?forbidden=1");
    for (const roles of [["OPS"], ["CONTENT"], ["ADS"], []] as const) {
      await expect(requireAdminAction(roles)).rejects.toThrow("redirect:/admin/magacin?forbidden=1");
    }
  });
  it("accepts only an explicit warehouse allow-list", async () => {
    expect(await requireAdminAction(["OPS", "WAREHOUSE"])).toMatchObject({ id: "operator" });
  });
  it("rechecks disabled or missing accounts on every request", async () => {
    mock.admin.mockResolvedValue(null);
    await expect(requireAdminAction(["WAREHOUSE"])).rejects.toThrow("redirect:/admin/magacin/prijava");
  });
});
