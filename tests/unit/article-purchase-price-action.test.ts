import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  admin: vi.fn(), product: vi.fn(), create: vi.fn(), audit: vi.fn(), finalize: vi.fn(), revalidate: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({ getCurrentAdmin: mocks.admin }));
vi.mock("@/lib/admin", async () => import("@/lib/admin/guard"));
vi.mock("@/lib/admin/audit", () => ({ logAudit: mocks.audit, finalizeAudit: mocks.finalize }));
vi.mock("@/lib/monitoring", () => ({ logOperationalError: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`redirect:${url}`); } }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/lib/db", () => ({ db: { product: { findUnique: mocks.product } } }));
vi.mock("@/lib/admin/purchase-price.server", () => ({ createPurchasePrice: mocks.create }));

import { addArticlePurchasePrice } from "@/app/admin/erp/artikli/[id]/purchase-price-actions";
import { EMPTY_ADMIN_ACTION_STATE } from "@/lib/admin/action-state";

function form() {
  const data = new FormData();
  for (const [key, value] of Object.entries({
    purchasePrice: "125,50", validFrom: "2026-10-26", validTo: "", sku: "FORGED", productId: "other",
    currency: "USD", parity: "FOB", cogs: "1", fullPrice: "1",
  })) data.set(key, value);
  return data;
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.admin.mockResolvedValue({ id: "operator", role: "OPS" });
  mocks.audit.mockResolvedValue({ id: "attempt" });
  mocks.finalize.mockResolvedValue(undefined);
  mocks.product.mockResolvedValue({ id: "current-product", sku: "001234" });
  mocks.create.mockResolvedValue({
    id: "new-price", productId: "current-product", sku: "001234", price: new Prisma.Decimal("125.50"),
    currency: "EUR", parity: "DAP", validFrom: new Date("2026-10-26T00:00:00Z"), validTo: null,
  });
});

describe("nabavna cena iz kartice artikla", () => {
  it("binds identity to the current product and audits the result without trusting hidden fields", async () => {
    const result = await addArticlePurchasePrice("current-product", EMPTY_ADMIN_ACTION_STATE, form());
    expect(result).toMatchObject({ ok: true, message: "Nabavna cena je sačuvana." });
    expect(mocks.product).toHaveBeenCalledWith({ where: { id: "current-product", deletedAt: null }, select: { id: true, sku: true } });
    expect(mocks.create).toHaveBeenCalledWith({ sku: "001234", purchasePrice: "125,50", validFrom: "2026-10-26", validTo: "" });
    expect(mocks.finalize).toHaveBeenCalledWith(expect.objectContaining({
      action: "article.purchase-price.create", entity: "PurchasePrice", entityId: "new-price",
      diff: expect.objectContaining({ productId: "current-product", sku: "001234", currency: "EUR", parity: "DAP", auditStatus: "SUCCEEDED" }),
    }));
    expect(mocks.revalidate.mock.calls).toEqual([["/admin/erp/artikli/current-product"], ["/admin/erp/nabavne-cene"]]);
  });

  it("uses the refreshed server SKU after an article rename", async () => {
    mocks.product.mockResolvedValue({ id: "current-product", sku: "RENAMED" });
    await addArticlePurchasePrice("current-product", EMPTY_ADMIN_ACTION_STATE, form());
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ sku: "RENAMED" }));
  });

  it.each(["CONTENT", "ADS", "WAREHOUSE"])("preserves purchasing authorization for %s", async role => {
    mocks.admin.mockResolvedValue({ id: "other-admin", role });
    await expect(addArticlePurchasePrice("current-product", EMPTY_ADMIN_ACTION_STATE, form())).rejects.toThrow("redirect:");
    expect(mocks.product).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("allows SUPER with the same purchasing behavior", async () => {
    mocks.admin.mockResolvedValue({ id: "super-admin", role: "SUPER" });
    expect(await addArticlePurchasePrice("current-product", EMPTY_ADMIN_ACTION_STATE, form())).toMatchObject({ ok: true });
  });

  it("requires an authenticated administrator before resolving the product", async () => {
    mocks.admin.mockResolvedValue(null);
    await expect(addArticlePurchasePrice("current-product", EMPTY_ADMIN_ACTION_STATE, form())).rejects.toThrow("redirect:/admin/prijava");
    expect(mocks.product).not.toHaveBeenCalled();
  });

  it("does not create a price for a missing or archived product", async () => {
    mocks.product.mockResolvedValue(null);
    expect(await addArticlePurchasePrice("gone", EMPTY_ADMIN_ACTION_STATE, form())).toMatchObject({ ok: false, message: expect.stringContaining("više nije dostupan") });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.revalidate).not.toHaveBeenCalled();
    expect(mocks.finalize).toHaveBeenCalledWith(expect.objectContaining({ action: "article.purchase-price.create.error" }));
  });

  it.each(["Cena za isti datum već postoji.", "Dobavljač nema ispravan paritet.", "Datum nije ispravan."])("returns existing purchase validation failures: %s", async message => {
    mocks.create.mockRejectedValue(new Error(message));
    expect(await addArticlePurchasePrice("current-product", EMPTY_ADMIN_ACTION_STATE, form())).toMatchObject({ ok: false, message });
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });

  it("does not write if the required attempt audit cannot be saved", async () => {
    mocks.audit.mockRejectedValue(new Error("audit unavailable"));
    expect(await addArticlePurchasePrice("current-product", EMPTY_ADMIN_ACTION_STATE, form())).toMatchObject({ ok: false, message: expect.stringContaining("audit zapis") });
    expect(mocks.product).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
