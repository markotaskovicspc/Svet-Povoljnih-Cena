import ExcelJS from "exceljs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ErpRow } from "@/lib/admin/erp";

const mocks = vi.hoisted(() => ({ authorize: vi.fn(), getModule: vi.fn(), getDefinition: vi.fn() }));
vi.mock("@/lib/admin", () => ({ requireAdminAction: mocks.authorize }));
vi.mock("@/lib/admin/erp", () => ({
  getErpModule: mocks.getModule, getErpModuleDefinition: mocks.getDefinition, countArticleRows: vi.fn(),
}));
vi.mock("@/lib/admin/erp-pagination", () => ({
  supportsErpDatabasePagination: () => false, countErpDatabaseRows: vi.fn(),
}));
import { GET as exportRows } from "@/app/api/admin/erp/[module]/export/route";
import { GET as listRows } from "@/app/api/admin/erp/[module]/rows/route";

const columns = [
  { key: "warehouse", label: "Magacin", defaultVisible: true },
  { key: "sku", label: "SKU", defaultVisible: true },
  { key: "product", label: "Artikal", defaultVisible: true },
  { key: "barcode", label: "Bar kod", defaultVisible: true },
  { key: "physical", label: "Fizičko", type: "number", defaultVisible: true },
];
const context = () => ({ params: Promise.resolve({ module: "stanje-po-magacinima" }) });
const rows: ErpRow[] = [
  { id: "one", values: { warehouse: "DC", sku: "001", product: "Zenske carape", barcode: "0012345678905", physical: 4 } },
  { id: "two", values: { warehouse: "DC", sku: "002", product: "Женске чарапе", barcode: "0001234567890", physical: 10 } },
  { id: "other-warehouse", values: { warehouse: "Niš", sku: "003", product: "Ženske čarape", barcode: null, physical: 50 } },
  { id: "other-product", values: { warehouse: "DC", sku: "004", product: "Muške čarape", barcode: null, physical: 60 } },
];
function params(query: string, searchColumn = "") {
  return new URLSearchParams({ q: query, searchColumn,
    columns: JSON.stringify(["sku", "product", "barcode", "physical"]),
    filters: JSON.stringify([{ columnKey: "warehouse", operator: "contains", value: "dc" }]),
    sorting: JSON.stringify([{ columnKey: "physical", direction: "desc" }]),
    pageSize: "1",
  });
}
async function readExport(search: URLSearchParams) {
  const response = await exportRows(new Request(`http://localhost/api/admin/erp/stanje-po-magacinima/export?${search}`), context());
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await response.arrayBuffer());
  return workbook.worksheets[0];
}
beforeEach(() => {
  mocks.authorize.mockResolvedValue(undefined);
  mocks.getDefinition.mockReturnValue({ columns });
  mocks.getModule.mockResolvedValue({ title: "DC lager", columns, rows });
});
describe("DC Excel matches the filtered table", () => {
  it.each(["Ženske čarape", "Zenske carape", "Женске чарапе", "  ŽENSKE ČARAPE  "])("exports all matching rows for %s with the same filters and sort", async query => {
    const search = params(query);
    const list = await (await listRows(new Request(`http://localhost/api/admin/erp/stanje-po-magacinima/rows?${search}`), context())).json();
    expect(list.total).toBe(2);
    expect(list.rows.map((row: ErpRow) => row.id)).toEqual(["two"]);
    const sheet = await readExport(search);
    expect(sheet.rowCount).toBe(list.total + 1);
    expect(sheet.getCell("A1").value).toBe("SKU");
    expect(sheet.getCell("C1").value).toBe("Bar kod");
    expect([2, 3].map(row => sheet.getCell(`A${row}`).value)).toEqual(["002", "001"]);
    expect(sheet.getCell("C2").value).toBe("0001234567890");
    expect(sheet.getCell("C3").value).toBe("0012345678905");
    expect(sheet.getCell("D2").value).toBe(10);
  });

  it("honors a selected search column even when another visible column matches", async () => {
    const sheet = await readExport(params("001", "barcode"));
    expect(sheet.rowCount).toBe(3);
    const noMatch = await readExport(params("Ženske čarape", "sku"));
    expect(noMatch.rowCount).toBe(1);
  });

  it("includes matches older than the first 10,000 warehouse balances", async () => {
    const all = Array.from({ length: 10_000 }, (_, index) => ({ id: `unrelated-${index}`, values: { warehouse: "DC", product: "Drugi artikal" } }));
    const complete = [...all, rows[0]];
    mocks.getModule.mockImplementation((_slug: string, options: { take: number }) => Promise.resolve({ title: "DC lager", columns, rows: complete.slice(0, options.take) }));
    const sheet = await readExport(params("Ženske čarape"));
    expect(sheet.rowCount).toBe(2);
    expect(sheet.getCell("A2").value).toBe("001");
  });

  it("does not read stock when authorization fails", async () => {
    mocks.authorize.mockRejectedValueOnce(new Error("Forbidden"));
    await expect(readExport(params(""))).rejects.toThrow("Forbidden");
    expect(mocks.getModule).not.toHaveBeenCalled();
  });
});
