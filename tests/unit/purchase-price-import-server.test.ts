import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";

const mocks = vi.hoisted(() => ({ transaction: vi.fn(), products: vi.fn(), history: vi.fn(), insert: vi.fn(), audit: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { $transaction: mocks.transaction } }));
vi.mock("@/lib/admin/purchase-price.server", () => ({ articleSnapshotSelect: {}, insertPurchasePriceInTransaction: mocks.insert }));

import { applyPurchasePriceImport, previewPurchasePriceImport } from "@/lib/admin/purchase-price-import.server";
import { parsePurchasePriceImportRows } from "@/lib/admin/purchase-price-import";
import { createInventoryImportToken } from "@/lib/admin/inventory-import-token";

const product = { id: "product-a", sku: "A", name: "Artikal A", supplier: { id: "supplier-a", code: "SUP", name: "Dobavljač", currency: "EUR", parity: "DAP" } };
const oldPrice = { id: "old-price", productId: "product-a", price: "5", validFrom: new Date("2029-01-01"), validTo: null, updatedAt: new Date("2029-01-01") };
const tx = { product: { findMany: mocks.products }, purchasePrice: { findMany: mocks.history }, auditLog: { create: mocks.audit } } as unknown as Prisma.TransactionClient;
const rows = () => parsePurchasePriceImportRows([["Šifra", "Nabavna cena", "Važenje od", "Važenje do", "Valuta", "Dobavljač"], ["A", "12,34", "2030-02-01", "", "EUR", "SUP"]]);
const tokenFor = (stateHash: string) => createInventoryImportToken({ adminId: "purchase-prices:admin-1", fileHash: "file-hash", stateHash });

describe("purchase price import preview and atomic application", () => {
  beforeEach(() => {
    vi.stubEnv("AUTH_SECRET", "a-real-test-secret-at-least-16-characters");
    mocks.products.mockResolvedValue([product]); mocks.history.mockResolvedValue([oldPrice]);
    mocks.insert.mockResolvedValue({ id: "new-price" }); mocks.audit.mockResolvedValue({ id: "audit" });
    mocks.transaction.mockImplementation(async callback => callback(tx));
  });

  it("resolves supplier data and shows previous period closure without writing", async () => {
    const preview = await previewPurchasePriceImport(tx, rows());
    expect(preview.valid).toBe(true);
    expect(preview.rows[0]).toMatchObject({ productId: "product-a", resolvedCurrency: "EUR", supplierName: "Dobavljač", closesPrevious: true });
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("shows historical insertion boundaries and next imported periods", async () => {
    mocks.history.mockResolvedValue([oldPrice, { ...oldPrice, id: "future", validFrom: new Date("2030-05-01") }]);
    const input = [...rows(), { ...rows()[0], row: 3, validFrom: "2030-03-01" }];
    const preview = await previewPurchasePriceImport(tx, input);
    expect(preview.rows.map(row => row.effectiveValidTo)).toEqual(["2030-02-28", "2030-04-30"]);
  });

  it("rejects missing/ambiguous products, missing suppliers, parity and supplier/currency mismatch", async () => {
    mocks.products.mockResolvedValue([]);
    expect((await previewPurchasePriceImport(tx, rows())).rows[0].errors.join()).toMatch(/nije pronađen/);
    mocks.products.mockResolvedValue([product, { ...product, id: "other" }]);
    expect((await previewPurchasePriceImport(tx, rows())).rows[0].errors.join()).toMatch(/jednoznačna/);
    mocks.products.mockResolvedValue([{ ...product, supplier: null }]);
    expect((await previewPurchasePriceImport(tx, rows())).rows[0].errors.join()).toMatch(/povezanog dobavljača/);
    mocks.products.mockResolvedValue([{ ...product, supplier: { ...product.supplier, currency: "RSD", parity: "XYZ", code: "OTHER", name: "Other" } }]);
    expect((await previewPurchasePriceImport(tx, rows())).rows[0].errors).toHaveLength(3);
  });

  it("rejects an existing date without overwriting", async () => {
    mocks.history.mockResolvedValue([{ ...oldPrice, validFrom: new Date("2030-02-01") }]);
    const preview = await previewPurchasePriceImport(tx, rows());
    expect(preview.valid).toBe(false);
    expect(preview.rows[0].errors.join()).toMatch(/već postoji/);
    await expect(applyPurchasePriceImport({ rows: rows(), fileHash: "file-hash", token: "invalid", adminId: "admin-1" })).rejects.toThrow(/Ispravite greške/);
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("revalidates state and refuses stale preview or another admin/file", async () => {
    const initial = await previewPurchasePriceImport(tx, rows()); const token = tokenFor(initial.stateHash);
    mocks.products.mockResolvedValue([{ ...product, name: "Promenjen naziv" }]);
    await expect(applyPurchasePriceImport({ rows: rows(), fileHash: "file-hash", token, adminId: "admin-1" })).rejects.toThrow(/podaci promenjeni/);
    mocks.products.mockResolvedValue([product]);
    await expect(applyPurchasePriceImport({ rows: rows(), fileHash: "other-file", token, adminId: "admin-1" })).rejects.toThrow(/podaci promenjeni/);
    await expect(applyPurchasePriceImport({ rows: rows(), fileHash: "file-hash", token, adminId: "admin-2" })).rejects.toThrow(/podaci promenjeni/);
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("applies ordered prices with original history rules and audit in one serializable transaction", async () => {
    const input = [{ ...rows()[0], validFrom: "2030-03-01" }, { ...rows()[0], row: 3 }];
    const preview = await previewPurchasePriceImport(tx, input);
    const result = await applyPurchasePriceImport({ rows: input, fileHash: "file-hash", token: tokenFor(preview.stateHash), adminId: "admin-1" });
    expect(result).toEqual({ count: 2 });
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({ isolationLevel: "Serializable" }));
    expect(mocks.insert.mock.calls.map(call => call[3])).toEqual([new Date("2030-02-01"), new Date("2030-03-01")]);
    expect(mocks.insert.mock.calls[0][1]).toMatchObject({ productId: "product-a", supplierId: "supplier-a", currency: "EUR", parity: "DAP" });
    expect(mocks.audit).toHaveBeenCalledWith({ data: expect.objectContaining({ actorId: "admin-1", action: "erp.purchase-prices.import" }) });
  });

  it("propagates write or audit failure to roll back the transaction", async () => {
    const preview = await previewPurchasePriceImport(tx, rows());
    const input = { rows: rows(), fileHash: "file-hash", token: tokenFor(preview.stateHash), adminId: "admin-1" };
    mocks.insert.mockRejectedValueOnce(new Error("write failed"));
    await expect(applyPurchasePriceImport(input)).rejects.toThrow("write failed");
    expect(mocks.audit).not.toHaveBeenCalled();
    mocks.audit.mockRejectedValueOnce(new Error("audit failed"));
    await expect(applyPurchasePriceImport(input)).rejects.toThrow("audit failed");
  });
});
