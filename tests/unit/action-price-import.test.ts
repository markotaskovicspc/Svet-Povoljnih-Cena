import { expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { parseActionPriceText, parseActionPriceRows } from "@/lib/admin/action-price-import";
import { actionPriceImportPreview } from "@/lib/admin/action-price-import.server";
it("reads Serbian CSV prices and preserves leading zero SKUs", () => {
  expect(parseActionPriceText('Šifra;Akcijska cena\n0012;"1.999,50"\nX-2;700')).toEqual([{ row: 2, sku: "0012", salePrice: 1999.5 }, { row: 3, sku: "X-2", salePrice: 700 }]);
  expect(parseActionPriceText('sku,saleprice\n001,1999.50')[0].salePrice).toBe(1999.5);
});
it.each(['sku;cena\na;0', 'sku;cena\na;1.2.3,4', 'sku;cena\na;1,2,3', 'sku;cena\na;NaN', 'sku;cena\na;-2', 'sku;cena\na;1e3', 'sku;cena\na;2\nA;3', 'sku;cena\n;2', 'wrong;columns\na;2'])("rejects invalid or duplicate entries", text => { expect(() => parseActionPriceText(text)).toThrow(); });
it("rejects empty and oversized spreadsheets", () => {
  expect(() => parseActionPriceRows([["sku", "cena"]])).toThrow();
  expect(() => parseActionPriceRows([["sku", "cena"], ...Array.from({length: 501}, (_, i) => [String(i), "10"])] )).toThrow();
});
function client() {
  return { action: { findUnique: vi.fn().mockResolvedValue({ id: "a", startsAt: new Date("2026-09-01"), endsAt: new Date("2026-09-30"), isPermanent: false }) }, product: { findMany: vi.fn().mockResolvedValue([{ id: "p", sku: "001", name: "Polica", fullPrice: 1500 }]) }, priceListEntry: { findMany: vi.fn().mockResolvedValue([{ productId: "p", price: 1000 }]) }, actionProduct: { findMany: vi.fn().mockResolvedValue([{ productId: "p", salePrice: 900 }]) } };
}
it("checks prices against the dated retail price and flags unknown SKUs", async () => {
  const tx = client();
  const preview = await actionPriceImportPreview(tx as unknown as Prisma.TransactionClient, "a", [{row: 2, sku:"001", salePrice:1100}, {row:3, sku:"missing", salePrice:1}]);
  expect(preview.valid).toBe(false); expect(preview.rows[0].error).toContain("mora biti manja"); expect(preview.rows[1].error).toContain("nije pronađena");
});
it("fingerprint changes if another admin changes existing sale or retail prices", async () => {
  const tx = client(); const rows = [{ row:2, sku:"001", salePrice:700 }];
  const first = await actionPriceImportPreview(tx as unknown as Prisma.TransactionClient, "a", rows);
  tx.actionProduct.findMany.mockResolvedValue([{ productId:"p", salePrice:800 }]);
  const second = await actionPriceImportPreview(tx as unknown as Prisma.TransactionClient, "a", rows);
  expect(first.valid).toBe(true); expect(second.fingerprint).not.toBe(first.fingerprint);
});
