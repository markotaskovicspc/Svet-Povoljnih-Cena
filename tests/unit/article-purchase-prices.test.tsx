import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

const mocks = vi.hoisted(() => ({ admin: vi.fn(), product: vi.fn(), prices: vi.fn() }));
vi.mock("@/lib/admin", async () => ({
  requireAdminAction: mocks.admin,
  isAuthorized: (await import("@/lib/admin/authorization")).isAuthorized,
}));
vi.mock("@/lib/db", () => ({ db: { product: { findUnique: mocks.product }, purchasePrice: { findMany: mocks.prices } } }));
vi.mock("@/app/admin/erp/artikli/[id]/purchase-price-actions", () => ({ addArticlePurchasePrice: vi.fn() }));
vi.mock("@/components/admin/action-form", () => ({ AdminActionForm: ({ children }: { children: ReactNode }) => <form>{children}</form> }));
vi.mock("@/components/admin/submit-button", () => ({ SubmitButton: ({ children }: { children: ReactNode }) => <button type="submit">{children}</button> }));
import { ArticlePurchasePrices } from "@/components/admin/article-purchase-prices";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.admin.mockResolvedValue({ role: "OPS" });
  mocks.product.mockResolvedValue({ id: "article", sku: "001234", supplier: { name: "Dobavljač", currency: "EUR", parity: "DAP" } });
  mocks.prices.mockResolvedValue([
    { id: "new", price: "125.50", currency: "EUR", parity: "DAP", validFrom: new Date("2026-10-26"), validTo: null, supplier: { name: "Novi dobavljač" } },
    { id: "old", price: "100", currency: "USD", parity: "FOB", validFrom: new Date("2026-01-01"), validTo: new Date("2026-10-25"), supplier: { name: "Stari dobavljač" } },
  ]);
});

it("shows per-period purchasing history and a separate form with currency from the supplier", async () => {
  const html = renderToStaticMarkup(await ArticlePurchasePrices({ productId: "article" }));
  for (const text of ["Nabavna cena (EUR)", "2026-10-26", "2026-10-25", "125,50", "100,00", "Stari dobavljač", "Novi dobavljač", "USD", "EUR", "FOB", "DAP"]) expect(html).toContain(text);
  expect(html).not.toContain('name="sku"');
  expect(html).not.toContain('name="cogs"');
  expect(html).not.toContain('name="fullPrice"');
  expect(mocks.prices).toHaveBeenCalledWith(expect.objectContaining({ where: { productId: "article" }, orderBy: [{ validFrom: "desc" }, { createdAt: "desc" }] }));
});

it("does not expose purchase history or its form to CONTENT", async () => {
  mocks.admin.mockResolvedValue({ role: "CONTENT" });
  expect(await ArticlePurchasePrices({ productId: "article" })).toBeNull();
  expect(mocks.product).not.toHaveBeenCalled();
  expect(mocks.prices).not.toHaveBeenCalled();
});

it("explains missing supplier setup and retains existing history", async () => {
  mocks.product.mockResolvedValue({ id: "article", sku: "001234", supplier: null });
  const html = renderToStaticMarkup(await ArticlePurchasePrices({ productId: "article" }));
  expect(html).toContain("prvo izaberite dobavljača");
  expect(html).toContain("Istorija nabavnih cena");
  expect(html).not.toContain("<form");
});

it("places the purchasing component after the article form and outside its Card", () => {
  const page = readFileSync(new URL("../../src/app/admin/erp/artikli/[id]/page.tsx", import.meta.url), "utf8");
  expect(page).toMatch(/<\/AdminActionForm>\s*<\/Card>\s*\{canAccessAdminModule\(admin, "\/admin\/erp\/nabavne-cene", \["OPS"\]\) && <ArticlePurchasePrices productId=\{product.id\}/);
});
