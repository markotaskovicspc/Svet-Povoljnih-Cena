import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ save: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/lib/admin", () => ({
  withAdminState: (_meta: unknown, handler: (actor: string, data: FormData) => unknown) =>
    (data: FormData) => handler("admin-1", data),
}));
vi.mock("@/lib/admin/reclamation-fulfillment.server", () => ({ saveReclamationWarehouse: mocks.save }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
import { saveWarehouseAction } from "@/app/admin/erp/reklamacije-dnevnik/warehouse-action";
beforeEach(() => vi.resetAllMocks());
it("acknowledges the saved preparation without waiting for a second page render", async () => {
  const data = new FormData();
  data.set("id", "claim-1"); data.set("warehouseId", "warehouse-1");
  data.set("replacementPackageRows", "0");
  for (const key of ["weightKg", "widthCm", "depthCm", "heightCm"]) data.set(`replacementPackage.0.${key}`, "10");
  mocks.save.mockResolvedValue({ warehouseId: "warehouse-1", warehouseStatus: "READY", replacementReadyAt: new Date() });
  const result = await saveWarehouseAction({ ok: false, message: "" }, data);
  expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ reclamationId: "claim-1", actorId: "admin-1", packages: [{ weightKg: 10, widthCm: 10, depthCm: 10, heightCm: 10 }] }));
  expect(result).toMatchObject({ ok: true, message: expect.stringContaining("Spremnost je sačuvana") });
  expect(mocks.revalidate).not.toHaveBeenCalled();
});
it("rejects missing warehouse before writing", async () => {
  expect(await saveWarehouseAction({ ok: false, message: "" }, new FormData())).toMatchObject({ ok: false });
  expect(mocks.save).not.toHaveBeenCalled();
});
