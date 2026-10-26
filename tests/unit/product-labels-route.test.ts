import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ guard: vi.fn(), find: vi.fn(), build: vi.fn() }));
vi.mock("@/lib/admin", () => ({ requireAdminAction: mocks.guard }));
vi.mock("@/lib/db", () => ({ db: { product: { findMany: mocks.find } } }));
vi.mock("@/lib/admin/product-labels.server", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/admin/product-labels.server")>(), buildProductLabelsPdf: mocks.build }));
import { GET, POST } from "@/app/api/admin/product-labels/route";

const product = { id: "a", sku: "000001", name: "Stolica", barcode: "8605079400014", countryOfOrigin: "CN", declaration: null, media: [{ url: "/chair.png", thumbUrl: null }] };
const request = (body: unknown) => new Request("http://localhost/api/admin/product-labels", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
beforeEach(() => { mocks.find.mockResolvedValue([product]); mocks.build.mockResolvedValue(Buffer.from("%PDF-test")); });

it("authorizes before any catalogue access and limits search results", async () => {
  mocks.guard.mockRejectedValueOnce(new Error("forbidden"));
  await expect(GET(new Request("http://localhost/api/admin/product-labels?q=stolica"))).rejects.toThrow("forbidden");
  expect(mocks.find).not.toHaveBeenCalled();
  const response = await GET(new Request("http://localhost/api/admin/product-labels?q=000001"));
  expect(mocks.guard).toHaveBeenCalledWith(["CONTENT", "OPS"], "/admin/erp/nalepnice");
  expect(mocks.find).toHaveBeenCalledWith(expect.objectContaining({ take: 20 }));
  expect((await response.json()).articles[0]).toMatchObject({ sku: "000001", countryOfOrigin: "Kina" });
  expect(response.headers.get("cache-control")).toContain("no-store");
});

it("prints current server-side values in selection order and prevents public PDF caching", async () => {
  const response = await POST(request({ items: [{ productId: "a", copies: 3 }], startPosition: 23, name: "Forged", barcode: "999" }));
  expect(response.status).toBe(200);
  expect(mocks.build).toHaveBeenCalledWith([{ article: expect.objectContaining({ sku: "000001", name: "Stolica", barcode: "8605079400014" }), copies: 3 }], 23);
  expect(response.headers.get("content-type")).toBe("application/pdf");
  expect(response.headers.get("cache-control")).toContain("private, no-store");
});

it("rejects stale selections and oversized jobs before rendering", async () => {
  const bad = await POST(request({ items: [{ productId: "a", copies: 481 }] }));
  expect(bad.status).toBe(400);
  expect(mocks.build).not.toHaveBeenCalled();
  const stale = await POST(request({ items: [{ productId: "missing", copies: 1 }] }));
  expect(stale.status).toBe(404);
  expect(mocks.build).not.toHaveBeenCalled();
});
