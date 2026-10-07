import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  admin: { id: "admin-a", role: "SUPER" },
  findMany: vi.fn(),
  findFirst: vi.fn(),
  findFirstOrThrow: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  upsert: vi.fn(),
  deleteMany: vi.fn(),
  updateMany: vi.fn(),
  raw: vi.fn(),
}));
vi.mock("@/lib/admin", () => ({
  requireAdminAction: async () => mocks.admin,
  isAuthorized: (role: string, roles: string[]) =>
    role === "SUPER" || roles.includes(role),
}));
vi.mock("@/lib/admin/erp", () => ({
  getErpModuleDefinition: (slug: string) =>
    ["artikli", "prodajni-nalozi"].includes(slug)
      ? { title: slug, columns: [{ key: "name" }], contextFilters: [] }
      : undefined,
}));
vi.mock("@/lib/db", () => {
  const db = { adminSavedView: mocks, $executeRaw: mocks.raw };
  return {
    db: { ...db, $transaction: (fn: (tx: typeof db) => unknown) => fn(db) },
  };
});
import { GET, POST, PATCH, DELETE } from "@/app/api/admin/saved-views/route";
const row = {
  id: "view-a",
  adminUserId: "admin-a",
  module: "prodajni-nalozi",
  name: "Nalozi",
  query: "ABC",
  filters: [],
  sorting: [],
  columns: {
    showInSidebar: true,
    sidebarOrder: 3,
    visibleColumns: ["name"],
    context: {},
  },
  isDefault: false,
};
function request(method: string, data: unknown) {
  return new Request("https://example.test/api/admin/saved-views", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(data),
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.admin.role = "SUPER";
  mocks.findFirst.mockResolvedValue(null);
  mocks.findMany.mockResolvedValue([row]);
  mocks.create.mockResolvedValue(row);
  mocks.upsert.mockResolvedValue(row);
  mocks.update.mockResolvedValue(row);
  mocks.findFirstOrThrow.mockResolvedValue(row);
});
describe("saved view ownership and mutations", () => {
  it("saves canonical grid shortcuts with their page filters in the menu", async () => {
    mocks.findMany.mockResolvedValue([
      {
        ...row,
        columns: { ...row.columns, routeContext: { channel: "WEB" } },
      },
    ]);
    const href = "/admin/erp/prodajni-nalozi?channel=WEB&savedView=view-a";
    const response = await POST(
      request("POST", {
        module: "admin-navigation",
        name: "Levi meni",
        isDefault: true,
        visibleColumns: [
          "/admin", href, "/admin/erp/prodajni-nalozi?savedView=foreign",
        ],
        columnOrder: [href, "/admin"],
      }),
    );
    expect(response.status).toBe(200);
    expect(mocks.findMany.mock.calls[0][0].where.adminUserId).toBe("admin-a");
    expect(mocks.upsert.mock.calls[0][0].create.columns).toMatchObject({
      visibleColumns: ["/admin", href],
      columnOrder: [href, "/admin"],
    });
  });

  it("does not allow pinned shortcuts outside the current role", async () => {
    mocks.admin.role = "CONTENT";
    const href = "/admin/erp/prodajni-nalozi?savedView=view-a";
    await POST(
      request("POST", {
        module: "admin-navigation",
        name: "Levi meni",
        visibleColumns: ["/admin", href],
        columnOrder: [href, "/admin"],
      }),
    );
    expect(mocks.upsert.mock.calls[0][0].create.columns).toMatchObject({
      visibleColumns: ["/admin"],
      columnOrder: ["/admin"],
    });
  });

  it("lists only the signed-in administrator's views", async () => {
    const response = await GET(
      new Request(
        "https://example.test/api/admin/saved-views?module=prodajni-nalozi",
      ),
    );
    expect(response.status).toBe(200);
    expect(mocks.findMany.mock.calls[0][0].where).toEqual({
      adminUserId: "admin-a",
      module: "prodajni-nalozi",
    });
  });
  it("rejects access to a module outside the role", async () => {
    mocks.admin.role = "ADS";
    expect(
      (
        await GET(
          new Request(
            "https://example.test/api/admin/saved-views?module=prodajni-nalozi",
          ),
        )
      ).status,
    ).toBe(403);
    expect(
      (await POST(request("POST", { module: "artikli", name: "A" }))).status,
    ).toBe(403);
    expect(mocks.findMany).not.toHaveBeenCalled();
  });
  it("creates independently and keeps safe page context", async () => {
    const response = await POST(
      request("POST", {
        module: "prodajni-nalozi",
        name: "Novi",
        query: "ABC",
        routeContext: { channel: "WEB", edit: "bad" },
        visibleColumns: ["name"],
      }),
    );
    expect(response.status).toBe(200);
    expect(mocks.create.mock.calls[0][0].data.columns).toMatchObject({
      showInSidebar: true,
      routeContext: { channel: "WEB" },
    });
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
  it("does not silently overwrite a name collision", async () => {
    mocks.findFirst.mockResolvedValue(row);
    expect(
      (await POST(request("POST", { module: row.module, name: row.name })))
        .status,
    ).toBe(409);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("updates the same ID and retains the saved shortcut order", async () => {
    mocks.findFirst.mockResolvedValueOnce(row).mockResolvedValueOnce(null);
    expect(
      (
        await POST(
          request("POST", {
            id: row.id,
            module: row.module,
            name: "Changed",
            query: "new",
          }),
        )
      ).status,
    ).toBe(200);
    expect(mocks.upsert.mock.calls[0][0]).toMatchObject({
      where: { id: row.id },
      update: { name: "Changed", query: "new", columns: { sidebarOrder: 3 } },
    });
  });
  it("cannot update, rename, or delete another account's view", async () => {
    mocks.deleteMany.mockResolvedValue({ count: 0 });
    expect(
      (
        await POST(
          request("POST", { id: "foreign", module: row.module, name: "A" }),
        )
      ).status,
    ).toBe(404);
    expect(
      (await PATCH(request("PATCH", { id: "foreign", name: "A" }))).status,
    ).toBe(404);
    expect((await DELETE(request("DELETE", { id: "foreign" }))).status).toBe(
      404,
    );
    expect(mocks.deleteMany.mock.calls[0][0].where).toEqual({
      id: "foreign",
      adminUserId: "admin-a",
    });
  });
  it("renames and unpins without losing filters or table state", async () => {
    mocks.findFirst.mockResolvedValue(row);
    expect(
      (
        await PATCH(
          request("PATCH", {
            id: row.id,
            name: "Renamed",
            showInSidebar: false,
          }),
        )
      ).status,
    ).toBe(200);
    expect(mocks.update.mock.calls[0][0].data).toEqual({
      name: "Renamed",
      columns: { ...row.columns, showInSidebar: false },
    });
  });
});
