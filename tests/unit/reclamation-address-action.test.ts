import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ save: vi.fn(), metadata: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/lib/admin", () => ({
  withAdminState: (meta: unknown, handler: (actor: string, data: FormData) => unknown) => {
    mocks.metadata(meta);
    return (data: FormData) => handler("admin-1", data);
  },
}));
vi.mock("@/lib/admin/reclamation-address.server", () => ({ saveReclamationAddress: mocks.save }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
import { saveAddressAction } from "@/app/admin/erp/reklamacije-dnevnik/address-action";
beforeEach(() => vi.clearAllMocks());
it("acknowledges the saved address without waiting for another server render", async () => {
  const fields = { id: "claim-1", shipFirstName: "QA", shipLastName: "Provera", shipPhone: "0641234567", shipStreet: "Nova", shipHouseNumber: "25A", shipCity: "Novi Sad", shipPostalCode: "21000", shipXExpressTownId: "802824" };
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  const diff = { before: null, after: { shipStreet: "Nova" } };
  mocks.save.mockResolvedValue(diff);
  const result = await saveAddressAction({ ok: false, message: "" }, data);
  expect(mocks.metadata).toHaveBeenCalledWith({ allowed: ["OPS"], module: "/admin/erp/reklamacije-dnevnik", action: "reclamation.addressUpdate", entity: "Reclamation" });
  expect(mocks.save).toHaveBeenCalledWith("claim-1", expect.objectContaining({ shipStreet: "Nova", shipHouseNumber: "25A", shipXExpressTownId: 802824 }));
  expect(result).toMatchObject({ ok: true, entityId: "claim-1", diff, message: expect.stringContaining("Adresa reklamacije je sačuvana") });
  expect(mocks.revalidate).not.toHaveBeenCalled();
});
it("rejects an absent reclamation before writing", async () => {
  expect(await saveAddressAction({ ok: false, message: "" }, new FormData())).toMatchObject({ ok: false });
  expect(mocks.save).not.toHaveBeenCalled();
});
