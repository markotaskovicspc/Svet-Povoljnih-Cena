import ExcelJS from "exceljs";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), preview: vi.fn(), apply: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/admin", () => ({ requireAdminAction: mocks.auth, withAdminState: vi.fn() }));
vi.mock("@/lib/admin/purchase-order-import.server", () => ({ purchaseOrderImportPreview: mocks.preview, applyPurchaseOrderImport: mocks.apply }));
import { previewPurchaseOrderImport } from "@/app/admin/erp/porudzbenice/import-actions";
function form(file: File) { const form = new FormData(); form.set("orderId", "po"); form.set("file", file); return form; }
async function xlsx(cellValue: ExcelJS.CellValue = "0001") {
  const book = new ExcelJS.Workbook(); const sheet = book.addWorksheet("Stavke");
  sheet.addRow(["Šifra", "Količina"]); sheet.addRow([cellValue, 4]);
  return new File([new Uint8Array(await book.xlsx.writeBuffer())], "stavke.xlsx");
}

describe("purchase order import upload boundary", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.auth.mockResolvedValue({ id: "admin" }); mocks.preview.mockResolvedValue({ rows: [], items: [{ purchaseOrderId: "private" }], valid: true, fingerprint: "hash" }); });
  it("authorizes OPS before parsing any upload", async () => {
    mocks.auth.mockRejectedValue(new Error("forbidden"));
    await expect(previewPurchaseOrderImport(form(new File(["sku,qty\nA,2"], "rows.csv")))).rejects.toThrow("forbidden");
    expect(mocks.auth).toHaveBeenCalledWith(["OPS"]); expect(mocks.preview).not.toHaveBeenCalled();
  });
  it("reads XLSX text SKUs and omits persistence-only snapshots from client payload", async () => {
    const result = await previewPurchaseOrderImport(form(await xlsx()));
    expect(result.ok).toBe(true);
    if (result.ok) { expect(result.input).toEqual([{ row: 2, sku: "0001", qty: 4 }]); expect(result.preview).not.toHaveProperty("items"); }
  });
  it("rejects XLSX formulas even when cached result exists", async () => {
    const result = await previewPurchaseOrderImport(form(await xlsx({ formula: '"0001"', result: "0001" })));
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/formula/) }); expect(mocks.preview).not.toHaveBeenCalled();
  });
  it("rejects oversized and unsupported files before DB work", async () => {
    expect(await previewPurchaseOrderImport(form(new File([new Uint8Array(512001)], "rows.csv")))).toMatchObject({ ok: false, error: expect.stringMatching(/500 KB/) });
    expect(await previewPurchaseOrderImport(form(new File(["anything"], "rows.xls")))).toMatchObject({ ok: false, error: expect.stringMatching(/CSV i XLSX/) });
    expect(mocks.preview).not.toHaveBeenCalled();
  });
  it("supports valid CSV uploads without performing apply", async () => {
    expect(await previewPurchaseOrderImport(form(new File(["sku,qty\n0001,4"], "rows.csv")))).toMatchObject({ ok: true });
    expect(mocks.apply).not.toHaveBeenCalled();
  });
});
