import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ authorize: vi.fn(), getModule: vi.fn(), count: vi.fn() }));
vi.mock("@/lib/admin", () => ({ requireAdminAction: mocks.authorize }));
vi.mock("@/lib/admin/erp", () => ({
  getErpModule: mocks.getModule,
  getErpModuleDefinition: () => ({ columns: [{ key: "name", defaultVisible: true }] }),
  countArticleRows: mocks.count,
}));
vi.mock("@/lib/admin/erp-pagination", () => ({
  supportsErpDatabasePagination: (slug: string) => slug === "kupci",
  countErpDatabaseRows: mocks.count,
}));
import { GET } from "@/app/api/admin/erp/[module]/rows/route";
const read = (params: Record<string, string> = {}) => GET(
  new Request(`http://localhost/api/admin/erp/kupci/rows?${new URLSearchParams(params)}`),
  { params: Promise.resolve({ module: "kupci" }) },
);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.authorize.mockResolvedValue(undefined);
  mocks.count.mockResolvedValue(250);
  mocks.getModule.mockResolvedValue({ rows: [{ id: "one", values: { name: "Ana" } }, { id: "two", values: { name: "Zoran" } }] });
});
describe("ERP rows database pagination", () => {
  it("reads only the requested database page and retains the complete count", async () => {
    const result = await (await read({ page: "2" })).json();
    expect(mocks.getModule).toHaveBeenCalledWith("kupci", expect.objectContaining({ take: 100, skip: 100 }));
    expect(result).toMatchObject({ page: 2, total: 250, pageCount: 3 });
    expect(result.rows).toHaveLength(2);
  });
  it("searches across all rows rather than just the first database page", async () => {
    const result = await (await read({ q: "Zoran" })).json();
    expect(mocks.getModule).toHaveBeenCalledWith("kupci", expect.objectContaining({ take: 500_000, skip: 0 }));
    expect(mocks.count).not.toHaveBeenCalled();
    expect(result.total).toBe(1);
    expect(result.rows[0].id).toBe("two");
  });
  it.each([
    { filters: JSON.stringify([{ columnKey: "name", operator: "equals", value: "Ana" }]) },
    { sorting: JSON.stringify([{ columnKey: "name", direction: "desc" }]) },
    { warehouseId: "warehouse" },
    { archive: "1" },
  ])("preserves full-list semantics for %j", async (params) => {
    await read(params);
    expect(mocks.getModule).toHaveBeenCalledWith("kupci", expect.objectContaining({ take: 500_000, skip: 0 }));
    expect(mocks.count).not.toHaveBeenCalled();
  });
  it("does not query data when authorization fails", async () => {
    mocks.authorize.mockRejectedValueOnce(new Error("Forbidden"));
    await expect(read()).rejects.toThrow("Forbidden");
    expect(mocks.getModule).not.toHaveBeenCalled();
    expect(mocks.count).not.toHaveBeenCalled();
  });
});
