import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), find: vi.fn(), transaction: vi.fn(), link: vi.fn(), audit: vi.fn(), members: vi.fn(), path: vi.fn(), tag: vi.fn() }));
vi.mock("@/lib/admin", () => ({ requireAdminAction: mocks.auth }));
vi.mock("@/lib/db", () => ({ db: { product: { findUnique: mocks.find }, $transaction: mocks.transaction, productFamilyMember: { findMany: mocks.members } } }));
vi.mock("@/lib/product-family.server", () => ({ linkExistingProductVariant: mocks.link }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.path, revalidateTag: mocks.tag }));
import { GET, POST } from "@/app/api/admin/product-family/link/route";
const input = { sourceId: "m", targetId: "s", sourceVersion: "2026-09-19T10:00:00.000Z", targetVersion: "2026-09-19T10:00:00.000Z", label: "S, crna" };
const request = (origin = "https://shop.test") => new Request("https://shop.test/api/admin/product-family/link", { method: "POST", headers: { origin, "Content-Type": "application/json" }, body: JSON.stringify(input) });
beforeEach(() => { vi.resetAllMocks(); mocks.auth.mockResolvedValue({ id: "admin" }); mocks.transaction.mockImplementation((callback) => callback({ auditLog: { create: mocks.audit } })); mocks.members.mockResolvedValue([{ productId: "s", product: { slug: "small" } }]); mocks.link.mockResolvedValue({ duplicate: false, familyId: "f", source: { sku: "110126" }, target: { sku: "110127" } }); });
it("does not read or write products when admin authorization fails", async () => {
  mocks.auth.mockRejectedValue(new Error("Unauthorized"));
  await expect(GET(new Request("https://shop.test/api/admin/product-family/link?sku=110127"))).rejects.toThrow("Unauthorized");
  await expect(POST(request())).rejects.toThrow("Unauthorized");
  expect(mocks.find).not.toHaveBeenCalled(); expect(mocks.transaction).not.toHaveBeenCalled();
});
it("rejects cross-origin mutations before opening a transaction", async () => {
  expect((await POST(request("https://other.test"))).status).toBe(403); expect(mocks.transaction).not.toHaveBeenCalled();
});
it("returns a versioned private preview without changing the product", async () => {
  mocks.find.mockResolvedValue({ id: "s", sku: "110127", name: "NANOTECH S", sizeLabel: "S", updatedAt: new Date(input.targetVersion), familyMembership: { label: "S, crna", family: { code: "110127", _count: { members: 1 } } } });
  const response = await GET(new Request("https://shop.test/api/admin/product-family/link?sku=110127"));
  expect(response.headers.get("Cache-Control")).toBe("private, no-store"); expect(await response.json()).toMatchObject({ version: input.targetVersion, label: "S, crna" }); expect(mocks.transaction).not.toHaveBeenCalled();
});
it("commits the link and audit together and refreshes storefront and admin caches", async () => {
  expect((await POST(request())).status).toBe(200);
  expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable", timeout: 20000 });
  expect(mocks.audit).toHaveBeenCalledOnce(); expect(mocks.path).toHaveBeenCalledWith("/p/small"); expect(mocks.tag).toHaveBeenCalledWith("catalog-products", { expire: 0 });
});
it("does not add a second audit on an idempotent retry or invalidate on rejected link", async () => {
  mocks.link.mockResolvedValueOnce({ duplicate: true, familyId: "f", source: { sku: "110126" }, target: { sku: "110127" } });
  await POST(request()); expect(mocks.audit).not.toHaveBeenCalled(); mocks.path.mockClear();
  mocks.link.mockRejectedValueOnce(new Error("Artikal je izmenjen")); expect((await POST(request())).status).toBe(400); expect(mocks.path).not.toHaveBeenCalled();
});
