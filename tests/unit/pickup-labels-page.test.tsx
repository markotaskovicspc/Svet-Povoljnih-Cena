import { beforeEach, expect, it, vi } from "vitest";
const { admin, redirect } = vi.hoisted(() => ({ admin: vi.fn(), redirect: vi.fn(() => { throw new Error("redirect"); }) }));
vi.mock("@/lib/admin", () => ({ requireAdminAction: admin }));
vi.mock("next/navigation", () => ({ redirect }));
import PickupLabelsPage from "@/app/admin/erp/preuzimanja/[id]/adresnice/page";
beforeEach(() => vi.clearAllMocks());

it("opens the alphabetically sorted PDF directly without an intermediate print screen", async () => {
  await expect(PickupLabelsPage({ params: Promise.resolve({ id: "batch" }) })).rejects.toThrow("redirect");
  expect(admin).toHaveBeenCalledWith(["OPS"]);
  expect(redirect).toHaveBeenCalledWith("/api/admin/erp/preuzimanja/batch/labels?sort=name");
});
it("does not redirect when the operator is unauthorized", async () => {
  admin.mockRejectedValueOnce(new Error("unauthorized"));
  await expect(PickupLabelsPage({ params: Promise.resolve({ id: "batch" }) })).rejects.toThrow("unauthorized");
  expect(redirect).not.toHaveBeenCalled();
});
