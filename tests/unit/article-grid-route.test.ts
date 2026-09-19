import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ authorize: vi.fn(), getModule: vi.fn(), select: vi.fn() }));
vi.mock("@/lib/admin", () => ({ requireAdminAction: mocks.authorize }));
vi.mock("@/lib/admin/erp", () => ({
  getErpModule: mocks.getModule,
  getErpModuleDefinition: () => ({ columns: ["supplier", "status", "stock"].map((key) => ({ key, defaultVisible: true })) }),
  countArticleRows: vi.fn(),
}));
vi.mock("@/lib/admin/article-grid-page", async (original) => ({
  ...await original<object>(), selectArticleGridPage: mocks.select,
}));
import { GET } from "@/app/api/admin/erp/[module]/rows/route";
const read = (filter = "supplier") => GET(new Request(`http://localhost/api/admin/erp/artikli/rows?${new URLSearchParams({ page: "2", pageSize: "25", filters: JSON.stringify([{ columnKey: filter, operator: "not_equals", value: "Rabalux" }]) })}`), { params: Promise.resolve({ module: "artikli" }) });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.authorize.mockResolvedValue(undefined);
  mocks.select.mockResolvedValue({ ids: ["b", "a"], total: 251 });
  mocks.getModule.mockResolvedValue({ rows: [{ id: "a", values: {} }, { id: "b", values: {} }] });
});
describe("article page hydration", () => {
  it("hydrates only selected IDs, retaining selection order and complete total", async () => {
    const result = await (await read()).json();
    expect(mocks.select).toHaveBeenCalledWith(expect.anything(), 25, 25);
    expect(mocks.getModule).toHaveBeenCalledWith("artikli", { take: 25, articleIds: ["b", "a"], warehouseId: null, includeLookupOptions: false });
    expect(result).toMatchObject({ total: 251, pageCount: 11, page: 2 });
    expect(result.rows.map((row: {id: string}) => row.id)).toEqual(["b", "a"]);
  });
  it("passes an explicit empty ID set rather than accidentally loading the whole catalog", async () => {
    mocks.select.mockResolvedValue({ ids: [], total: 0 });
    expect((await (await read()).json()).rows).toEqual([]);
    expect(mocks.getModule).toHaveBeenCalledWith("artikli", expect.objectContaining({ articleIds: [] }));
  });
  it("keeps calculated stock filters on the original complete data path", async () => {
    await read("stock");
    expect(mocks.select).not.toHaveBeenCalled();
    expect(mocks.getModule).toHaveBeenCalledWith("artikli", expect.objectContaining({ take: 500_000 }));
  });
  it("authorizes before reading any candidates", async () => {
    mocks.authorize.mockRejectedValue(new Error("Forbidden"));
    await expect(read()).rejects.toThrow("Forbidden");
    expect(mocks.select).not.toHaveBeenCalled();
    expect(mocks.getModule).not.toHaveBeenCalled();
  });
});
