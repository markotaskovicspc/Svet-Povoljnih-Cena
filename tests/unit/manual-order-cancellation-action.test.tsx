import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ cancel: vi.fn(), admin: vi.fn(), revalidate: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/lib/admin", () => ({ withAdminState: mocks.admin }));
vi.mock("@/lib/orders/manual-cancellation.server", () => ({ cancelManualSalesOrder: mocks.cancel }));
vi.mock("@/components/admin/action-form", () => ({ AdminActionForm: ({ children }: { children: React.ReactNode }) => <form>{children}</form> }));
vi.mock("@/components/admin/submit-button", () => ({ SubmitButton: ({ children, confirm }: { children: React.ReactNode; confirm: string }) => <button data-confirm={confirm}>{children}</button> }));
import { cancelManualOrderAction, ManualOrderCancellation } from "@/components/admin/manual-order-cancellation";
import { EMPTY_ADMIN_ACTION_STATE } from "@/lib/admin/action-state";

beforeEach(() => { vi.resetAllMocks(); });

it("requires OPS authorization and uses the authenticated actor before cancelling", async () => {
  mocks.admin.mockImplementation((_meta, handler) => (data: FormData) => handler("authenticated-actor", data));
  mocks.cancel.mockResolvedValue({ id: "order", number: "MP-2026-00004", alreadyCancelled: false });
  const data = new FormData(); data.set("id", "order"); data.set("actorId", "forged-actor");
  await expect(cancelManualOrderAction(EMPTY_ADMIN_ACTION_STATE, data)).resolves.toMatchObject({ ok: true, entityId: "order" });
  expect(mocks.admin).toHaveBeenCalledWith({ module: "/admin/erp/prodajni-nalozi", allowed: ["OPS"], action: "order.manualCancel", entity: "Order" }, expect.any(Function));
  expect(mocks.cancel).toHaveBeenCalledExactlyOnceWith("order", "authenticated-actor");
  expect(mocks.revalidate).toHaveBeenCalledWith("/admin/erp/artikli/[id]/zalihe", "page");
});

it("does not reach cancellation when authorization rejects the request", async () => {
  mocks.admin.mockReturnValue(() => { throw new Error("Unauthorized"); });
  await expect(cancelManualOrderAction(EMPTY_ADMIN_ACTION_STATE, new FormData())).rejects.toThrow("Unauthorized");
  expect(mocks.cancel).not.toHaveBeenCalled();
  expect(mocks.revalidate).not.toHaveBeenCalled();
});

it("clearly confirms cancellation of all items while preserving the order", () => {
  const html = renderToStaticMarkup(<ManualOrderCancellation id="order" number="MP-2026-00004" />);
  expect(html).toContain("Otkaži porudžbinu");
  expect(html).toContain("Rezervacije svih artikala biće oslobođene");
  expect(html).toContain("Nalog i istorija ostaju sačuvani");
  expect(html).toContain('name="id" value="order"');
});
