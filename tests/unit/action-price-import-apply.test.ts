import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ preview: vi.fn(), upsert: vi.fn(), update: vi.fn(), transaction: vi.fn(), authorize: vi.fn() }));
vi.mock("@/lib/admin/action-price-import.server", () => ({ actionPriceImportPreview: mocks.preview }));
vi.mock("@/lib/db", () => ({ db: { $transaction: mocks.transaction } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));
vi.mock("@/lib/admin", () => ({ requireAdminAction: vi.fn(), withAdminState: (options: unknown, fn: (actor: unknown, form: FormData) => unknown) => (form: FormData) => { mocks.authorize(options); return fn({}, form); } }));
import { applyActionPriceImport } from "@/app/admin/erp/akcije/import-actions";
function form() {
  const data = new FormData(); data.set("actionId", "a"); data.set("fingerprint", "reviewed");
  data.set("rows", JSON.stringify([{ row: 2, sku: "001", salePrice: 700 }])); return data;
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.transaction.mockImplementation(fn => fn({ actionProduct: { upsert: mocks.upsert }, action: { update: mocks.update } }));
  mocks.preview.mockResolvedValue({ valid: true, fingerprint: "reviewed", rows: [{ productId: "p", salePrice: 700 }] });
});
it.each([{ valid: false, fingerprint: "reviewed" }, { valid: true, fingerprint: "changed" }])("rejects invalid or stale previews before any write", async preview => {
  mocks.preview.mockResolvedValue(preview);
  await expect(applyActionPriceImport(undefined, form())).rejects.toThrow();
  expect(mocks.upsert).not.toHaveBeenCalled(); expect(mocks.update).not.toHaveBeenCalled();
});
it("writes the reviewed prices and adds products without removing other action products", async () => {
  await applyActionPriceImport(undefined, form());
  expect(mocks.authorize).toHaveBeenCalledWith(expect.objectContaining({ allowed: ["CONTENT"], action: "action.products.import" }));
  expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable", timeout: 60_000 });
  expect(mocks.upsert).toHaveBeenCalledWith({ where: { actionId_productId: { actionId: "a", productId: "p" } }, create: { actionId: "a", productId: "p", salePrice: 700 }, update: { salePrice: 700 } });
  expect(mocks.update).toHaveBeenCalledWith({ where: { id: "a" }, data: { products: { connect: [{ id: "p" }] } } });
});
it("rejects forged duplicate rows before opening the transaction", async () => {
  const data = form(); data.set("rows", JSON.stringify([{ row: 2, sku: "001", salePrice: 700 }, { row: 3, sku: "001", salePrice: 600 }]));
  await expect(applyActionPriceImport(undefined, data)).rejects.toThrow(); expect(mocks.transaction).not.toHaveBeenCalled();
});
